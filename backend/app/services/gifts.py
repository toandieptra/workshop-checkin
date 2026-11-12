"""Quà tặng sau khảo sát: phát hành mã, kiểm tra điều kiện và đổi quà nguyên tử.

QR chỉ chứa token ngẫu nhiên (không SĐT, không ID). DB chỉ lưu SHA-256 của token
và của mã nhập tay, nên lộ DB không lộ mã còn hiệu lực.
"""
import hashlib
import re
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import GiftAuditLog, GiftClaim, GiftConfig, Guest, SurveyResponse, Workshop
from .survey_text import mask_phone, normalize_phone
from .surveys import now_utc

QR_PREFIX = "LMG1:"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32,64}$")

MESSAGES = {
    "invalid_format": "Mã không hợp lệ. Quét lại QR hoặc kiểm tra mã nhập tay.",
    "not_found": "Không tìm thấy mã quà tặng.",
    "wrong_workshop": "Mã không thuộc workshop này.",
    "revoked": "Mã quà tặng đã bị thu hồi.",
    "already_redeemed": "Mã quà tặng đã được sử dụng.",
    "expired": "Mã nhận quà đã hết hạn.",
    "gift_disabled": "Chương trình quà tặng của workshop đang tạm dừng.",
    "invalid_response": "Phiếu khảo sát gắn với mã này không còn hợp lệ.",
    "invalid_registration": "Đăng ký workshop của khách không còn hợp lệ.",
    "ok": "Mã hợp lệ — xác nhận để trao quà.",
    "redeemed": "Đã trao quà thành công.",
}


def hash_token(token: str) -> str:
    return hashlib.sha256(f"gift-token:{token}".encode()).hexdigest()


def hash_code(code: str) -> str:
    return hashlib.sha256(f"gift-code:{code}".encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(24)


def new_short_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))


def format_code(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


def parse_input(raw: str) -> tuple[str, str] | None:
    """('token', value) cho QR, ('code', value) cho mã nhập tay; None nếu sai định dạng."""
    value = (raw or "").strip()
    if value.upper().startswith(QR_PREFIX):
        token = value[len(QR_PREFIX):].strip()
        return ("token", token) if _TOKEN_RE.match(token) else None
    code = re.sub(r"[^A-Za-z0-9]", "", value).upper()
    if code.startswith("LM") and len(code) == 10:
        code = code[2:]
    if len(code) == 8 and all(c in CODE_ALPHABET for c in code):
        return ("code", code)
    return None


_PHONE_SQL = "regexp_replace(regexp_replace(coalesce(guests.phone, ''), '\\D', '', 'g'), '^84(\\d{9,})$', '0\\1') = :norm"


async def registrations_for(db: AsyncSession, workshop_id: uuid.UUID, phone: str) -> list[Guest]:
    """Mọi đăng ký (chưa xoá) của workshop khớp SĐT đã chuẩn hoá ở cả hai phía."""
    norm = normalize_phone(phone)
    if not norm:
        return []
    return list((await db.execute(
        select(Guest).where(
            Guest.workshop_id == workshop_id, Guest.deleted_at.is_(None), Guest.phone.is_not(None), text(_PHONE_SQL),
        ).params(norm=norm).order_by(Guest.created_at)
    )).scalars().all())


async def registration_for(db: AsyncSession, workshop_id: uuid.UUID, phone: str) -> Guest | None:
    rows = await registrations_for(db, workshop_id, phone)
    checked = [g for g in rows if g.checkin_status == "checked_in"]
    return (checked or rows or [None])[0]


def checked_in_count(guest: Guest) -> int:
    """Số khách đã check-in của một đăng ký (0 nếu chưa check-in)."""
    if guest.deleted_at is not None or guest.checkin_status != "checked_in":
        return 0
    return max(1, guest.actual_party_size or guest.party_size or 1)


async def phone_quota(db: AsyncSession, survey_id: uuid.UUID, workshop_id: uuid.UUID, phone: str) -> tuple[int, int]:
    """(số phiếu tối đa = tổng khách đã check-in của SĐT, số phiếu hợp lệ đã gửi)."""
    guests = await registrations_for(db, workshop_id, phone)
    quota = sum(checked_in_count(g) for g in guests)
    used = await db.scalar(
        select(func.count()).select_from(SurveyResponse).where(
            SurveyResponse.survey_id == survey_id, SurveyResponse.phone == normalize_phone(phone),
            SurveyResponse.is_valid.is_(True),
        )
    ) or 0
    return quota, used


async def lock_phone(db: AsyncSession, survey_id: uuid.UUID, phone: str) -> None:
    """Khoá theo (survey, SĐT) trong giao dịch để hai thiết bị gửi cùng lúc không vượt quota."""
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": f"survey-phone:{survey_id}:{normalize_phone(phone)}"})


def registration_meets(guest: Guest | None, eligibility: str = "checked_in") -> bool:
    """Chính sách hiện hành: chỉ khách đã check-in mới làm khảo sát và nhận quà.
    `eligibility` cũ (registered/confirmed) được giữ trong DB nhưng không nới lỏng điều kiện này."""
    return guest is not None and checked_in_count(guest) > 0


@dataclass
class IssueResult:
    variant: str  # gift | none | ineligible
    reason: str | None = None
    claim: GiftClaim | None = None
    token: str | None = None
    code: str | None = None


async def _assign_codes(db: AsyncSession, claim: GiftClaim) -> tuple[str, str]:
    # Token 192-bit và mã 40-bit: khả năng trùng không đáng kể; nếu trùng, unique index
    # làm giao dịch lỗi thay vì phát hành hai mã giống nhau.
    token, code = new_token(), new_short_code()
    claim.token_hash, claim.short_code_hash = hash_token(token), hash_code(code)
    await db.flush()
    return token, code


async def issue_for_response(db: AsyncSession, workshop: Workshop, response: SurveyResponse) -> IssueResult:
    config = await db.get(GiftConfig, workshop.id)
    if config is None or not config.enabled:
        return IssueResult("none")
    now = now_utc()
    if config.redeem_until and now >= config.redeem_until:
        return IssueResult("ineligible", "expired")
    guests = [g for g in await registrations_for(db, workshop.id, response.phone) if checked_in_count(g) > 0]
    if not guests:
        return IssueResult("ineligible", "not_checked_in")
    # Nhiều đăng ký chung SĐT: gán quà cho đăng ký còn suất để cột “Quà tặng” mỗi dòng không vượt số khách.
    issued = dict((await db.execute(
        select(GiftClaim.guest_id, func.count()).where(
            GiftClaim.workshop_id == workshop.id, GiftClaim.guest_id.in_([g.id for g in guests]), GiftClaim.status != "revoked",
        ).group_by(GiftClaim.guest_id)
    )).all())
    guest = next((g for g in guests if issued.get(g.id, 0) < checked_in_count(g)), guests[0])
    response.guest_id = guest.id
    claim = GiftClaim(
        workshop_id=workshop.id, survey_id=response.survey_id, response_id=response.id, guest_id=guest.id,
        status="issued", gift_name_snapshot=config.gift_name, expires_at=config.redeem_until,
        token_hash="pending-" + uuid.uuid4().hex, short_code_hash="pending-" + uuid.uuid4().hex,
    )
    db.add(claim)
    token, code = await _assign_codes(db, claim)
    db.add(GiftAuditLog(workshop_id=workshop.id, claim_id=claim.id, action="issue", result="ok", detail={}))
    return IssueResult("gift", claim=claim, token=token, code=code)


async def reissue(db: AsyncSession, claim: GiftClaim) -> tuple[str, str]:
    """Xoay token + mã nhập tay; mã cũ mất hiệu lực ngay."""
    token, code = await _assign_codes(db, claim)
    claim.updated_at = now_utc()
    db.add(GiftAuditLog(workshop_id=claim.workshop_id, claim_id=claim.id, action="reissue", result="ok", detail={}))
    return token, code


def effective_status(claim: GiftClaim, config: GiftConfig | None, at: datetime | None = None) -> str:
    at = at or now_utc()
    if claim.status in ("redeemed", "revoked", "expired"):
        return claim.status
    deadline = claim.expires_at or (config.redeem_until if config else None)
    if deadline and at >= deadline:
        return "expired"
    return claim.status


@dataclass
class Verdict:
    result: str
    claim: GiftClaim | None = None
    info: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.result == "ok"

    @property
    def message(self) -> str:
        return MESSAGES.get(self.result, self.result)


async def find_claim(db: AsyncSession, raw: str, *, lock: bool = False) -> tuple[str | None, GiftClaim | None]:
    parsed = parse_input(raw)
    if parsed is None:
        return "invalid_format", None
    kind, value = parsed
    query = select(GiftClaim).where(
        GiftClaim.token_hash == hash_token(value) if kind == "token" else GiftClaim.short_code_hash == hash_code(value)
    )
    if lock:
        query = query.with_for_update()
    claim = (await db.execute(query)).scalar_one_or_none()
    return (None if claim else "not_found"), claim


async def evaluate(db: AsyncSession, claim: GiftClaim, workshop_id: uuid.UUID) -> Verdict:
    """Quy tắc kiểm tra theo thứ tự: workshop → thu hồi → đã dùng → hết hạn → cấu hình → phiếu → đăng ký."""
    if claim.workshop_id != workshop_id:
        return Verdict("wrong_workshop", claim)
    config = await db.get(GiftConfig, claim.workshop_id)
    status = effective_status(claim, config)
    if status == "revoked":
        return Verdict("revoked", claim)
    if status == "redeemed":
        return Verdict("already_redeemed", claim)
    if status == "expired":
        if claim.status != "expired":
            claim.status = "expired"
            claim.updated_at = now_utc()
        return Verdict("expired", claim)
    if config is None or not config.enabled:
        return Verdict("gift_disabled", claim)
    response = await db.get(SurveyResponse, claim.response_id)
    if response is None or not response.is_valid:
        return Verdict("invalid_response", claim)
    guest = await db.get(Guest, claim.guest_id) if claim.guest_id else None
    if (
        guest is None or guest.workshop_id != claim.workshop_id
        or normalize_phone(guest.phone) != normalize_phone(response.phone)
        or not registration_meets(guest)
    ):
        return Verdict("invalid_registration", claim)
    return Verdict("ok", claim)


async def claim_info(db: AsyncSession, claim: GiftClaim) -> dict:
    response = await db.get(SurveyResponse, claim.response_id)
    workshop = await db.get(Workshop, claim.workshop_id)
    redeemer = None
    if claim.redeemed_by:
        from ..models import AdminUser
        user = await db.get(AdminUser, claim.redeemed_by)
        redeemer = (user.name or user.email or user.username) if user else None
    return {
        "claim_id": str(claim.id),
        "guest_id": str(claim.guest_id) if claim.guest_id else None,
        "workshop_id": str(claim.workshop_id),
        "workshop_name": workshop.name if workshop else None,
        "status": claim.status,
        "gift_name": claim.gift_name_snapshot,
        "guest_name": response.full_name if response else None,
        "phone_masked": mask_phone(response.phone) if response else None,
        "rating": response.rating if response else None,
        "submitted_at": response.submitted_at.isoformat() if response else None,
        "issued_at": claim.issued_at.isoformat() if claim.issued_at else None,
        "expires_at": claim.expires_at.isoformat() if claim.expires_at else None,
        "redeemed_at": claim.redeemed_at.isoformat() if claim.redeemed_at else None,
        "redeemed_by": redeemer,
    }


def audit(db: AsyncSession, *, workshop_id, claim: GiftClaim | None, action: str, result: str, actor_id, detail: dict | None = None):
    db.add(GiftAuditLog(
        workshop_id=workshop_id, claim_id=claim.id if claim else None, action=action, result=result,
        actor_user_id=actor_id, detail=detail or {},
    ))


async def redeemed_counts(db: AsyncSession, guest_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Số quà đã trao (nhân viên quét hợp lệ và xác nhận) theo từng đăng ký — cột “Quà tặng”."""
    if not guest_ids:
        return {}
    rows = (await db.execute(
        select(GiftClaim.guest_id, func.count()).where(GiftClaim.guest_id.in_(guest_ids), GiftClaim.status == "redeemed")
        .group_by(GiftClaim.guest_id)
    )).all()
    return {gid: n for gid, n in rows}
