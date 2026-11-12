"""Chuẩn hoá chữ và số điện thoại cho catalog, survey và quà tặng."""
import re
import unicodedata

_COMBINING = re.compile(r"[̀-ͯ]")
_VN_MOBILE = re.compile(r"^0(3|5|7|8|9)\d{8}$")
_SLUG_INVALID = re.compile(r"[^a-z0-9]+")


def search_key(text: str | None) -> str:
    """Bỏ dấu tiếng Việt, đ→d, chữ thường — khớp tìm kiếm không dấu của survey."""
    value = unicodedata.normalize("NFD", text or "")
    value = _COMBINING.sub("", value).replace("đ", "d").replace("Đ", "D")
    return " ".join(value.lower().split())


def slugify(text: str | None) -> str:
    return _SLUG_INVALID.sub("-", search_key(text)).strip("-")[:80]


def normalize_phone(phone: str | None) -> str:
    """Cùng quy tắc với guests: chỉ giữ số, 84xxxxxxxxx → 0xxxxxxxxx."""
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if digits.startswith("84") and len(digits) >= 11:
        digits = "0" + digits[2:]
    return digits


def is_valid_vn_mobile(phone: str | None) -> bool:
    return bool(_VN_MOBILE.match(normalize_phone(phone)))


def mask_phone(phone: str | None) -> str:
    """09•• ••• 678 — dùng cho admin list, màn nhân viên và màn cảm ơn."""
    digits = normalize_phone(phone)
    if len(digits) < 6:
        return "•••"
    return f"{digits[:2]}•• ••• {digits[-3:]}"


def clean_text(value, max_len: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_len]
