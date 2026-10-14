"""Gửi tin ZBS hàng loạt tới danh sách khách được chọn trong một workshop.

Mỗi khách đủ điều kiện được xếp thành một ZbsDelivery riêng (event_type
``bulk_campaign``) và worker ZBS hiện có gửi dần như tin thủ công. Thông tin lượt
gửi (bulk_id, người tạo) nằm trong payload nên không cần bảng riêng.
"""
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Guest, Workshop, ZbsDelivery, ZbsTemplate
from .zbs import BULK_TASK_KEY, _checkin_time, _registered_at, _workshop_time, normalize_phone, zbs_phone

FIXED_SOURCE = "fixed"
ACTIVE_STATUSES = ("pending", "sending", "sent", "delivered")
VALID_PHONE = re.compile(r"0\d{9}")

# Nguồn dữ liệu có thể gắn vào tham số của mẫu tin; khóa là giá trị gửi từ client.
PARAM_SOURCES: dict[str, str] = {
    "guest.full_name": "Tên khách",
    "guest.phone": "SĐT khách (định dạng 84...)",
    "guest.email": "Email khách",
    "guest.company": "Công ty",
    "guest.party_size": "Số lượng khách đăng ký",
    "guest.registered_at": "Thời điểm đăng ký",
    "guest.checked_in_at": "Thời điểm check-in",
    "workshop.name": "Tên workshop",
    "workshop.location": "Địa điểm workshop",
    "workshop.time": "Thời gian workshop",
    FIXED_SOURCE: "Giá trị cố định",
}
# Nguồn văn bản được cắt theo maxLength của Zalo, giống tin tự động hiện có.
CLIPPABLE_SOURCES = {"guest.full_name", "guest.company", "workshop.name", "workshop.location"}
DEFAULT_SOURCES = {
    "customer_name": "guest.full_name",
    "name": "guest.full_name",
    "workshop": "workshop.name",
    "workshop_name": "workshop.name",
    "customer_phone": "guest.phone",
    "phone": "guest.phone",
    "customer_email": "guest.email",
    "email": "guest.email",
    "company": "guest.company",
    "workshop_address": "workshop.location",
    "address": "workshop.location",
    "workshop_time": "workshop.time",
    "customer_qty": "guest.party_size",
    "customer_checkin_time": "guest.checked_in_at",
}


def template_params(template: ZbsTemplate) -> list[dict]:
    params = (template.detail or {}).get("listParams") or []
    return [param for param in params if isinstance(param, dict) and param.get("name")]


def default_mapping(params: list[dict]) -> dict[str, dict]:
    return {
        param["name"]: {"source": DEFAULT_SOURCES.get(param["name"], FIXED_SOURCE), "value": ""}
        for param in params
    }


def _source_value(source: str, guest: Guest, workshop: Workshop) -> str | int:
    match source:
        case "guest.full_name":
            return (guest.full_name or "").strip()
        case "guest.phone":
            phone = normalize_phone(guest.phone)
            return zbs_phone(phone) if phone else ""
        case "guest.email":
            return (guest.email or "").strip()
        case "guest.company":
            return (guest.company or "").strip()
        case "guest.party_size":
            return int(guest.party_size or 1)
        case "guest.registered_at":
            return _checkin_time(_registered_at(guest))
        case "guest.checked_in_at":
            return _checkin_time(guest.checked_in_at)
        case "workshop.name":
            return (workshop.name or "").strip()
        case "workshop.location":
            return (workshop.location or "").strip()
        case "workshop.time":
            return _workshop_time(workshop)
    raise ValueError(f"Nguồn dữ liệu không hợp lệ: {source}")


def _param_value(param: dict, source: str, raw: str | int) -> tuple[str | int | None, str | None]:
    name = param["name"]
    text = str(raw).strip() if raw is not None else ""
    if not text:
        return None, f"Thiếu giá trị cho tham số {name}" if param.get("require") else None
    if str(param.get("type") or "").upper() == "NUMBER":
        if isinstance(raw, int):
            return raw, None
        if not re.fullmatch(r"-?\d+", text):
            return None, f"Tham số {name} phải là số"
        return int(text), None
    max_length = int(param.get("maxLength") or 0)
    if max_length and len(text) > max_length:
        if source in CLIPPABLE_SOURCES:
            return text[:max_length], None
        return None, f"Tham số {name} vượt quá {max_length} ký tự"
    return text, None


def validate_mapping(params: list[dict], mapping: dict[str, dict]) -> list[str]:
    """Lỗi cấu hình chung cho mọi khách: nguồn sai hoặc giá trị cố định không hợp lệ."""
    errors = []
    for param in params:
        entry = mapping.get(param["name"]) or {}
        source = entry.get("source") or FIXED_SOURCE
        if source not in PARAM_SOURCES:
            errors.append(f"Nguồn dữ liệu không hợp lệ cho tham số {param['name']}")
        elif source == FIXED_SOURCE:
            _, error = _param_value(param, source, entry.get("value") or "")
            if error:
                errors.append(error)
    return errors


def render_template_data(
    params: list[dict], mapping: dict[str, dict], guest: Guest, workshop: Workshop,
) -> tuple[dict, list[str]]:
    data: dict = {}
    errors: list[str] = []
    for param in params:
        entry = mapping.get(param["name"]) or {}
        source = entry.get("source") or FIXED_SOURCE
        raw = (entry.get("value") or "") if source == FIXED_SOURCE else _source_value(source, guest, workshop)
        value, error = _param_value(param, source, raw)
        if error:
            errors.append(error)
        elif value is not None:
            data[param["name"]] = value
    return data, errors


async def previous_bulk_statuses(
    db: AsyncSession, template_id: str, guest_ids: list[uuid.UUID],
) -> dict[uuid.UUID, ZbsDelivery]:
    """Lượt gửi hàng loạt gần nhất của từng khách với cùng mẫu tin."""
    if not guest_ids:
        return {}
    deliveries = (await db.execute(
        select(ZbsDelivery)
        .where(
            ZbsDelivery.event_type == BULK_TASK_KEY,
            ZbsDelivery.template_id == template_id,
            ZbsDelivery.guest_id.in_(guest_ids),
        )
        .order_by(ZbsDelivery.created_at.desc())
    )).scalars().all()
    latest: dict[uuid.UUID, ZbsDelivery] = {}
    for delivery in deliveries:
        latest.setdefault(delivery.guest_id, delivery)
    return latest


async def evaluate_recipients(
    db: AsyncSession,
    template: ZbsTemplate,
    workshop: Workshop,
    guests: list[Guest],
    mapping: dict[str, dict],
    allow_resend: bool = False,
) -> list[dict]:
    params = template_params(template)
    previous = await previous_bulk_statuses(db, template.template_id, [guest.id for guest in guests])
    seen_phones: set[str] = set()
    results = []
    for guest in guests:
        phone = normalize_phone(guest.phone)
        data, errors = render_template_data(params, mapping, guest, workshop)
        reason = None
        if not phone:
            reason = "Khách chưa có số điện thoại"
        elif not VALID_PHONE.fullmatch(phone):
            reason = "Số điện thoại không hợp lệ"
        elif phone in seen_phones:
            reason = "Trùng số điện thoại với khách khác trong danh sách"
        elif errors:
            reason = errors[0]
        elif not allow_resend and guest.id in previous and previous[guest.id].status in ACTIVE_STATUSES:
            reason = "Đã gửi hoặc đang xếp hàng mẫu tin này"
        if phone and reason is None:
            seen_phones.add(phone)
        results.append({
            "guest_id": guest.id,
            "full_name": guest.full_name,
            "phone": phone or None,
            "eligible": reason is None,
            "reason": reason,
            "template_data": data,
        })
    return results


def enqueue_bulk(
    db: AsyncSession,
    template: ZbsTemplate,
    workshop: Workshop,
    recipients: list[dict],
    bulk_id: uuid.UUID,
    created_by,
) -> list[ZbsDelivery]:
    now = datetime.now(timezone.utc)
    deliveries = []
    for recipient in recipients:
        delivery = ZbsDelivery(
            guest_id=recipient["guest_id"],
            workshop_id=workshop.id,
            event_type=BULK_TASK_KEY,
            event_key=f"{BULK_TASK_KEY}:{bulk_id}:{recipient['guest_id']}",
            phone=recipient["phone"],
            template_id=template.template_id,
            payload={
                "template_data": recipient["template_data"],
                "event_at": now.isoformat(),
                "manual": True,
                "bulk_id": str(bulk_id),
                "created_by": str(created_by.id) if created_by else None,
                "created_by_name": (created_by.name or created_by.email or created_by.username) if created_by else None,
            },
            status="pending",
            next_attempt_at=now,
        )
        db.add(delivery)
        deliveries.append(delivery)
    return deliveries
