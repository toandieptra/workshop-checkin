"""Password credentials and the deliberately fixed privileges of event staff."""
import base64
import hashlib
import hmac
import secrets
import re
import threading
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from ..models import AdminUser
from ..redis_client import get_redis

CHECKIN_GUEST_PERMISSIONS = frozenset({"guests.read", "guests.create", "checkin.read", "checkin.manage"})
PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128
_SCRYPT_N = 2 ** 17
# Bound memory use when several password attempts arrive together.
_HASH_SLOTS = threading.BoundedSemaphore(2)
_DUMMY_SALT = b"workshop-login-dummy-salt"


def account_type(user: AdminUser) -> str:
    return getattr(user, "account_type", None) or "lark"


def is_checkin_guest(user: AdminUser) -> bool:
    return account_type(user) == "checkin_guest"


def utc_datetime(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def guest_access_active(user: AdminUser, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    start = getattr(user, "access_starts_at", None)
    end = getattr(user, "access_expires_at", None)
    # Chỉ xét khung thời gian; phạm vi workshop được kiểm tra riêng (guest_has_workshop).
    return bool(user.is_active and start and end and utc_datetime(start) <= now < utc_datetime(end))


def normalize_username(value: str) -> str:
    username = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,63}", username):
        raise ValueError("Username cần 3–64 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang; bắt đầu bằng chữ hoặc số.")
    return username


def account_access_payload(user: AdminUser) -> dict:
    return {"account_type": account_type(user),
            "username": getattr(user, "username", None),
            "access_starts_at": getattr(user, "access_starts_at", None),
            "access_expires_at": getattr(user, "access_expires_at", None)}


def _derive(password: str, salt: bytes) -> bytes:
    with _HASH_SLOTS:
        return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=8, p=1,
                              maxmem=256 * 1024 * 1024, dklen=32)


def hash_password(password: str) -> str:
    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        raise ValueError("Mật khẩu phải có từ 12 đến 128 ký tự.")
    salt = secrets.token_bytes(16)
    digest = _derive(password, salt)
    return "scrypt$131072$8$1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, encoded: str | None) -> bool:
    # Missing/invalid credentials still pay the same derivation cost, including
    # Lark-only addresses, so account existence is not exposed through timing.
    valid = False
    salt, expected = _DUMMY_SALT, b"\0" * 32
    if encoded:
        try:
            algorithm, n, r, p, raw_salt, raw_digest = encoded.split("$")
            candidate_salt = base64.b64decode(raw_salt, validate=True)
            candidate_digest = base64.b64decode(raw_digest, validate=True)
            if (algorithm, n, r, p) == ("scrypt", "131072", "8", "1") and len(candidate_salt) == 16 and len(candidate_digest) == 32:
                salt, expected, valid = candidate_salt, candidate_digest, True
        except (ValueError, TypeError):
            pass
    actual = _derive(password, salt)
    return hmac.compare_digest(actual, expected) and valid


_RATE_LIMIT_SCRIPT = """
local account = redis.call('INCR', KEYS[1])
if account == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local address = redis.call('INCR', KEYS[2])
if address == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
return {account, address}
"""


async def check_login_rate_limit(request: Request, identifier: str) -> None:
    # request.client is normalized by the server's trusted proxy middleware;
    # never trust an arbitrary client-supplied X-Forwarded-For value here.
    address = request.client.host if request.client else "unknown"
    identifier_key = hashlib.sha256(identifier.strip().lower().encode()).hexdigest()
    address_key = hashlib.sha256(address.encode()).hexdigest()
    try:
        counts = await get_redis().eval(_RATE_LIMIT_SCRIPT, 2,
                                       f"auth:login:identifier:{identifier_key}",
                                       f"auth:login:ip:{address_key}", 900)
        account_count, address_count = map(int, counts)
    except Exception as exc:
        raise HTTPException(503, "Đăng nhập tạm thời không khả dụng. Vui lòng thử lại sau.") from exc
    if account_count > 10 or address_count > 50:
        raise HTTPException(429, "Đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.",
                            headers={"Retry-After": "900"})
