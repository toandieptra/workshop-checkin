import asyncio
import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, date, time, timezone, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..config import settings
from ..models import Guest, Workshop, WorkshopMedia, SyncLog
from ..services import lark_client
from ..services.lark_client import LarkError
from ..auth.dependencies import require_permission

logger = logging.getLogger("lark")
router = APIRouter(prefix="/api/lark", tags=["lark"])

# ===== Field names in Lark registration table =====
F_FULL_NAME = "Họ và tên"
F_PHONE = "Số điện thoại"
F_BUSINESS_MODEL = "Mô hình kinh doanh"
F_TICKETS = "Số vé đăng ký"
F_WORKSHOP = "Workshop (final)"
F_WORKSHOP_SALE = "Workshop (sale)"
F_REGISTERED_AT = "Ngày tạo"
F_REGISTERED_AT_FALLBACK = "ngày tạo"
F_CHECKIN = "Check-in"

# ===== Field names in Lark workshop config table =====
WF_NAME = "Workshop"
WF_DATE = "Ngày sự kiện"
WF_DATE_TEXT = "Ngày"  # text "dd/mm/yyyy hh:mm" — fallback giờ
WF_LOCATION = "Địa điểm sự kiện"
WF_BRANCH = "Chi Nhánh"
WF_MAPS = "Định Vị"
WF_SHORT_URL = "Short link đăng ký Workshop"
WF_IMAGES = "Ảnh WS"

# Lark timestamp (ms) lưu theo local VN (UTC+7)
_VN_TZ = timezone(timedelta(hours=7))

# ===== Sync status constants =====
SYNC_OK = "synced"
SYNC_PENDING_PUSH = "pending_push"
SYNC_CONFLICT = "conflict"
SYNC_ERROR = "error"

# ===== Background poll interval =====
SYNC_INTERVAL = 30

# -----------------------------------------------------------------
# Internal helpers (not FastAPI handlers)
# -----------------------------------------------------------------

def _slugify(text: str) -> str:
    s = text.lower().strip()
    rep = {
        "àáảãạăằắẳẵặâầấẩẫậ": "a", "èéẻẽẹêềếểễệ": "e", "ìíỉĩị": "i",
        "òóỏõọôồốổỗộơờớởỡợ": "o", "ùúủũụưừứửữự": "u", "ỳýỷỹỵ": "y", "đ": "d",
    }
    for chars, r in rep.items():
        for c in chars:
            s = s.replace(c, r)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "workshop"


def _parse_date(raw) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(raw / 1000, tz=_VN_TZ).date()
        except (ValueError, OSError):
            return None
    if isinstance(raw, str):
        s = raw.strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
    return None


def _field_text_segments(raw) -> str | None:
    """Lấy text từ field Lark dạng list[{text,type}] hoặc str."""
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw.strip() or None
    if isinstance(raw, list):
        parts = []
        for item in raw:
            if isinstance(item, dict) and item.get("text"):
                parts.append(str(item["text"]))
            elif isinstance(item, str):
                parts.append(item)
        return " ".join(parts).strip() or None
    return None


def _parse_time(raw, fallback_raw=None) -> time | None:
    """Parse giờ sự kiện từ timestamp ms (VN) hoặc text 'dd/mm/yyyy hh:mm'."""
    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(raw / 1000, tz=_VN_TZ).time().replace(second=0, microsecond=0)
        except (ValueError, OSError):
            pass
    for candidate in (raw, fallback_raw):
        text = _field_text_segments(candidate)
        if not text:
            continue
        for fmt in ("%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%H:%M"):
            try:
                return datetime.strptime(text.strip(), fmt).time().replace(second=0, microsecond=0)
            except ValueError:
                continue
        m = re.search(r"(\d{1,2}):(\d{2})", text)
        if m:
            try:
                return time(int(m.group(1)), int(m.group(2)))
            except ValueError:
                pass
    return None


def _parse_link(raw) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw.strip() or None
    if isinstance(raw, dict):
        return (raw.get("link") or raw.get("text") or "").strip() or None
    if isinstance(raw, list) and raw:
        return _parse_link(raw[0])
    return None


def _parse_attachments(raw) -> list[dict]:
    """Parse field attachment Lark (Ảnh WS) → list dict file_token/name/type/size/url."""
    if not raw:
        return []
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        ft = item.get("file_token") or item.get("token")
        if not ft:
            continue
        out.append({
            "file_token": ft,
            "name": item.get("name") or f"{ft}.bin",
            "type": item.get("type") or item.get("mime_type"),
            "size": item.get("size"),
            "url": item.get("url"),
            "extra": None,
        })
        # Lấy extra từ query string url/tmp_url nếu có
        for key in ("url", "tmp_url"):
            u = item.get(key) or ""
            if "extra=" in u:
                try:
                    from urllib.parse import urlparse, parse_qs
                    qs = parse_qs(urlparse(u).query)
                    if qs.get("extra"):
                        out[-1]["extra"] = qs["extra"][0]
                        break
                except Exception:
                    pass
    return out


async def _sync_workshop_images(db: AsyncSession, workshop: Workshop, fields: dict) -> int:
    """Tải Ảnh WS từ Lark vào uploads/workshops/{id}/ và tạo WorkshopMedia nếu chưa có.
    Trả số file mới thêm.
    """
    attachments = _parse_attachments(fields.get(WF_IMAGES))
    if not attachments:
        return 0

    existing = (await db.execute(
        select(WorkshopMedia).where(WorkshopMedia.workshop_id == workshop.id)
    )).scalars().all()
    existing_tokens = set()
    for m in existing:
        # file lưu dạng {file_token}__{name} hoặc chứa token trong url
        base = os.path.basename((m.file_url or "").split("?")[0])
        if "__" in base:
            existing_tokens.add(base.split("__", 1)[0])
        if m.file_name:
            existing_tokens.add(m.file_name)

    max_order = max((m.sort_order for m in existing), default=-1)
    target_dir = Path(settings.UPLOAD_DIR) / "workshops" / str(workshop.id)
    target_dir.mkdir(parents=True, exist_ok=True)
    table_id = settings.LARK_TABLE_WORKSHOPS
    added = 0

    for att in attachments:
        ft = att["file_token"]
        if ft in existing_tokens:
            continue
        # tránh trùng theo prefix file
        if any(p.name.startswith(ft + "__") for p in target_dir.glob(f"{ft}__*")):
            continue
        try:
            data, content_type = await lark_client.download_bitable_media(
                ft,
                table_id=table_id,
                extra=att.get("extra"),
            )
        except Exception as e:
            logger.warning("download Ảnh WS failed workshop=%s token=%s: %s", workshop.id, ft, e)
            continue
        if not data:
            continue
        orig = att.get("name") or f"{ft}.jpg"
        # sanitize
        safe = re.sub(r"[^\w.\-]+", "_", orig, flags=re.UNICODE)[:120] or "image.jpg"
        fname = f"{ft}__{safe}"
        (target_dir / fname).write_bytes(data)
        max_order += 1
        mime = att.get("type") or content_type or "image/jpeg"
        db.add(WorkshopMedia(
            workshop_id=workshop.id,
            media_type="banner",
            file_url=f"/uploads/workshops/{workshop.id}/{fname}",
            file_name=orig,
            mime_type=mime,
            file_size=len(data),
            sort_order=max_order,
        ))
        existing_tokens.add(ft)
        added += 1

    return added


def _parse_lark_datetime_ms(raw) -> datetime | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(raw / 1000, tz=timezone.utc)
        except (ValueError, OSError):
            return None
    if isinstance(raw, str):
        s = raw.strip()
        if s.isdigit():
            return _parse_lark_datetime_ms(int(s))
        for fmt in ("%Y/%m/%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(s, fmt)
                return dt.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return None


def _record_checksum(full_name: str, phone: str, checkin_status: str) -> str:
    key = f"{full_name or ''}|{phone or ''}|{checkin_status or ''}"
    return hashlib.md5(key.encode()).hexdigest()[:16]


def _parse_checkin_bool(raw) -> bool:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, int):
        return raw != 0
    if isinstance(raw, str):
        s = raw.strip().lower()
        return s in ("true", "1", "yes", "y", "có", "co", "✓", "✔")
    return False


async def _log_sync(
    db: AsyncSession,
    direction: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    lark_record_id: str | None,
    status: str,
    error_message: str | None = None,
    payload: dict | None = None,
):
    log_entry = SyncLog(
        direction=direction,
        entity_type=entity_type,
        entity_id=entity_id,
        lark_record_id=lark_record_id,
        status=status,
        error_message=error_message,
        payload=json.dumps(payload) if payload else None,
    )
    db.add(log_entry)


async def _resolve_workshop(db: AsyncSession, lark_workshop_name: str, target_id: uuid.UUID | None) -> Workshop:
    if target_id:
        w = await db.get(Workshop, target_id)
        if not w:
            raise HTTPException(404, "target workshop not found")
        if not w.lark_workshop_name:
            w.lark_workshop_name = lark_workshop_name
        return w
    w = (await db.execute(
        select(Workshop).where(Workshop.lark_workshop_name == lark_workshop_name)
    )).scalar_one_or_none()
    if w:
        return w
    meta = None
    if settings.LARK_TABLE_WORKSHOPS:
        try:
            recs = await lark_client.list_records(settings.LARK_TABLE_WORKSHOPS)
            for rec in recs:
                f = rec.get("fields", {})
                if lark_client.field_text(f, WF_NAME) == lark_workshop_name:
                    meta = f
                    break
        except Exception:
            pass
    slug_base = _slugify(lark_workshop_name)
    slug = slug_base
    n = 1
    while (await db.execute(select(Workshop).where(Workshop.slug == slug))).scalar_one_or_none():
        n += 1
        slug = f"{slug_base}-{n}"
    w = Workshop(
        name=lark_workshop_name,
        slug=slug,
        event_date=_parse_date(meta.get(WF_DATE)) if meta else None,
        event_time=_parse_time(meta.get(WF_DATE), meta.get(WF_DATE_TEXT)) if meta else None,
        location=lark_client.field_text(meta, WF_LOCATION) if meta else None,
        branch=lark_client.field_text(meta, WF_BRANCH) if meta else None,
        maps_url=_parse_link(meta.get(WF_MAPS)) if meta else None,
        registration_short_url=lark_client.field_text(meta, WF_SHORT_URL) if meta else None,
        lark_workshop_name=lark_workshop_name,
        status="published",
    )
    db.add(w)
    await db.flush()
    return w


async def _sync_workshops_from_lark(db: AsyncSession) -> dict:
    """Đồng bộ danh sách workshop từ Lark config table xuống DB local.

    - Tạo mới nếu chưa có (theo lark_workshop_name).
    - Cập nhật name/event_date/event_time/location/branch/maps/short_url nếu đã có và khác.
    - Fail + báo lỗi nếu slug bị trùng với workshop khác (không tự thêm hậu tố).
    """
    if not settings.LARK_TABLE_WORKSHOPS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_WORKSHOPS")

    records = await lark_client.list_records(settings.LARK_TABLE_WORKSHOPS)
    now = datetime.now(timezone.utc)

    # Dedupe theo tên (giống logic list_lark_workshops)
    seen: set[str] = set()
    parsed: list[tuple[str, dict]] = []
    for rec in records:
        f = rec.get("fields", {})
        name = lark_client.field_text(f, WF_NAME)
        if not name or name in seen:
            continue
        seen.add(name)
        parsed.append((name, f))

    created = updated = errors = 0
    media_added = 0
    error_details: list[str] = []
    out: list[dict] = []

    for name, f in parsed:
        event_date = _parse_date(f.get(WF_DATE))
        event_time = _parse_time(f.get(WF_DATE), f.get(WF_DATE_TEXT))
        location = lark_client.field_text(f, WF_LOCATION)
        branch = lark_client.field_text(f, WF_BRANCH)
        maps_url = _parse_link(f.get(WF_MAPS))
        short_url = lark_client.field_text(f, WF_SHORT_URL)

        existing = (await db.execute(
            select(Workshop).where(Workshop.lark_workshop_name == name)
        )).scalar_one_or_none()

        try:
            if existing is None:
                slug = _slugify(name)
                slug_taken = (await db.execute(
                    select(Workshop).where(Workshop.slug == slug)
                )).scalar_one_or_none()
                if slug_taken is not None:
                    raise LarkError(
                        f"Slug '{slug}' đã được dùng bởi workshop khác "
                        f"(không thể tạo '{name}')"
                    )
                w = Workshop(
                    name=name,
                    slug=slug,
                    event_date=event_date,
                    event_time=event_time,
                    location=location,
                    branch=branch,
                    maps_url=maps_url,
                    registration_short_url=short_url,
                    lark_workshop_name=name,
                    status="published",
                    last_synced_at=now,
                )
                db.add(w)
                created += 1
                is_new = True
                changed = True
            else:
                changed = False
                if existing.name != name:
                    existing.name = name
                    changed = True
                if existing.event_date != event_date:
                    existing.event_date = event_date
                    changed = True
                if existing.event_time != event_time:
                    existing.event_time = event_time
                    changed = True
                if (existing.location or None) != (location or None):
                    existing.location = location
                    changed = True
                if (existing.branch or None) != (branch or None):
                    existing.branch = branch
                    changed = True
                if (existing.maps_url or None) != (maps_url or None):
                    existing.maps_url = maps_url
                    changed = True
                if (existing.registration_short_url or None) != (short_url or None):
                    existing.registration_short_url = short_url
                    changed = True
                existing.last_synced_at = now
                if changed:
                    updated += 1
                is_new = False
                w = existing
            await db.flush()
            imgs = await _sync_workshop_images(db, w, f)
            media_added += imgs
            if imgs and not is_new and not changed:
                updated += 1
            out.append({
                "lark_workshop_name": name,
                "event_date": event_date.isoformat() if event_date else None,
                "event_time": event_time.strftime("%H:%M") if event_time else None,
                "location": location,
                "branch": branch,
                "workshop_id": str(w.id),
                "is_new": is_new,
                "media_added": imgs,
            })
        except LarkError as e:
            errors += 1
            error_details.append(f"{name}: {e}")
        except Exception as e:
            errors += 1
            error_details.append(f"{name}: {e}")
            logger.warning("sync workshop '%s' failed: %s", name, e)

    await db.commit()
    return {
        "total": len(parsed),
        "created": created,
        "updated": updated,
        "media_added": media_added,
        "errors": errors,
        "error_details": error_details,
        "workshops": out,
    }


async def _push_guest_to_lark(db: AsyncSession, guest: Guest) -> str | None:
    """Push guest to Lark. Creates record if no lark_record_id yet."""
    if guest.lark_record_id:
        return guest.lark_record_id
    if not settings.LARK_TABLE_REGISTRATIONS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_REGISTRATIONS")

    workshop = await db.get(Workshop, guest.workshop_id)
    if not workshop:
        raise HTTPException(404, "workshop not found")

    lark_workshop_name = workshop.lark_workshop_name or workshop.name
    if not workshop.lark_workshop_name:
        workshop.lark_workshop_name = lark_workshop_name

    fields = {
        F_FULL_NAME: guest.full_name,
        F_PHONE: guest.phone or "",
        F_BUSINESS_MODEL: guest.business_model or "",
        F_TICKETS: max(1, int(guest.party_size or 1)),
        F_WORKSHOP_SALE: lark_workshop_name,
    }
    record_id = await lark_client.create_record(settings.LARK_TABLE_REGISTRATIONS, fields)
    guest.lark_record_id = record_id
    guest.sync_status = SYNC_OK
    guest.last_synced_at = datetime.now(timezone.utc)
    guest.sync_error = None
    await db.commit()
    return record_id


def _workshop_datetime_ms(workshop: Workshop) -> int | None:
    """Gộp event_date + event_time thành timestamp ms theo giờ VN (UTC+7).
    Đảo ngược _parse_date/_parse_time. Chỉ có ngày thì đặt 00:00."""
    if not workshop.event_date:
        return None
    t = workshop.event_time or time(0, 0)
    dt = datetime.combine(workshop.event_date, t, tzinfo=_VN_TZ)
    return int(dt.timestamp() * 1000)


def _workshop_datetime_text(workshop: Workshop) -> str | None:
    """Chuỗi 'dd/mm/yyyy hh:mm' cho field text (fallback khi WF_DATE readonly)."""
    if not workshop.event_date:
        return None
    t = workshop.event_time or time(0, 0)
    return f"{workshop.event_date.strftime('%d/%m/%Y')} {t.strftime('%H:%M')}"


async def _sync_workshop_images_to_lark(db: AsyncSession, workshop: Workshop) -> list[dict]:
    """Upload các ảnh local (chưa có lark_file_token) lên Lark, trả danh sách
    {"file_token": ...} cho toàn bộ ảnh có token để ghi vào field attachment."""
    media = (await db.execute(
        select(WorkshopMedia).where(WorkshopMedia.workshop_id == workshop.id)
        .order_by(WorkshopMedia.sort_order)
    )).scalars().all()

    tokens: list[dict] = []
    for m in media:
        mime = (m.mime_type or "").lower()
        if not mime.startswith("image/"):
            continue
        if not m.lark_file_token:
            try:
                rel = (m.file_url or "")
                if not rel.startswith("/uploads/"):
                    continue
                path = Path(settings.UPLOAD_DIR) / rel[len("/uploads/"):]
                if not path.is_file():
                    continue
                data = path.read_bytes()
                token = await lark_client.upload_bitable_media(
                    m.file_name or path.name, data, m.mime_type,
                )
                m.lark_file_token = token
            except Exception as e:
                logger.warning("upload workshop image to lark failed media=%s: %s", m.id, e)
                continue
        tokens.append({"file_token": m.lark_file_token})
    return tokens


async def _push_workshop_to_lark(db: AsyncSession, workshop: Workshop) -> str | None:
    """Push workshop local -> Lark config table.

    - Tạo record nếu chưa có (dò theo tên trước để tránh trùng), ngược lại update.
    - Đẩy name/ngày-giờ/địa điểm/chi nhánh/maps/short_url + ảnh (best-effort).
    """
    if not settings.LARK_WRITEBACK_ENABLED or not settings.LARK_TABLE_WORKSHOPS:
        return None

    table_id = settings.LARK_TABLE_WORKSHOPS
    lark_name = workshop.lark_workshop_name or workshop.name
    if not workshop.lark_workshop_name:
        workshop.lark_workshop_name = lark_name

    fields: dict = {WF_NAME: lark_name}
    if workshop.location:
        fields[WF_LOCATION] = workshop.location
    if workshop.branch:
        fields[WF_BRANCH] = workshop.branch
    if workshop.registration_short_url:
        fields[WF_SHORT_URL] = workshop.registration_short_url
    if workshop.maps_url:
        fields[WF_MAPS] = {"link": workshop.maps_url, "text": workshop.maps_url}
    dt_ms = _workshop_datetime_ms(workshop)
    if dt_ms is not None:
        fields[WF_DATE] = dt_ms
    dt_text = _workshop_datetime_text(workshop)
    if dt_text:
        fields[WF_DATE_TEXT] = dt_text

    # Ảnh (best-effort, không chặn push text)
    try:
        img_tokens = await _sync_workshop_images_to_lark(db, workshop)
        if img_tokens:
            fields[WF_IMAGES] = img_tokens
    except Exception as e:
        logger.warning("sync workshop images to lark failed workshop=%s: %s", workshop.id, e)

    # Chống trùng: dò record theo tên nếu chưa có record_id
    record_id = workshop.lark_record_id
    if not record_id:
        try:
            recs = await lark_client.list_records(table_id)
            for rec in recs:
                if lark_client.field_text(rec.get("fields", {}), WF_NAME) == lark_name:
                    record_id = rec.get("record_id")
                    break
        except Exception as e:
            logger.warning("lookup workshop on lark failed name=%s: %s", lark_name, e)

    try:
        if record_id:
            # Nếu WF_DATE là field readonly/formula, thử lại không có nó
            try:
                await lark_client.update_record(table_id, record_id, fields)
            except LarkError:
                fields.pop(WF_DATE, None)
                await lark_client.update_record(table_id, record_id, fields)
        else:
            try:
                record_id = await lark_client.create_record(table_id, fields)
            except LarkError:
                fields.pop(WF_DATE, None)
                record_id = await lark_client.create_record(table_id, fields)
        workshop.lark_record_id = record_id
        workshop.last_synced_at = datetime.now(timezone.utc)
        await _log_sync(db, "local_to_lark", "workshop", workshop.id, record_id, SYNC_OK)
        await db.commit()
        return record_id
    except Exception as e:
        await _log_sync(db, "local_to_lark", "workshop", workshop.id, record_id, SYNC_ERROR, error_message=str(e))
        await db.commit()
        raise


# -----------------------------------------------------------------
# Pull logic (Lark → Local)
# -----------------------------------------------------------------

async def _sync_pull_to_local(
    db: AsyncSession,
    workshop: Workshop,
) -> dict:
    """Pull records from Lark and update local guests. Returns stats."""
    if not settings.LARK_TABLE_REGISTRATIONS:
        return {"pulled": 0, "conflicts": 0, "errors": 0}

    records = await lark_client.list_records(settings.LARK_TABLE_REGISTRATIONS)
    lark_map = {
        rec.get("record_id"): rec.get("fields", {})
        for rec in records
        if lark_client.field_text(rec.get("fields", {}), F_WORKSHOP) == workshop.lark_workshop_name
    }

    existing = {
        g.lark_record_id: g
        for g in (await db.execute(
            select(Guest).where(
                Guest.workshop_id == workshop.id,
                Guest.lark_record_id.is_not(None),
            )
        )).scalars().all()
        if g.lark_record_id
    }

    pulled = conflicts = errors = 0

    for rid, fields in lark_map.items():
        full_name = lark_client.field_text(fields, F_FULL_NAME)
        if not rid or not full_name:
            continue

        phone = lark_client.field_text(fields, F_PHONE)
        business_model = lark_client.field_text(fields, F_BUSINESS_MODEL)
        party_size = lark_client.field_int(fields, F_TICKETS, default=1)
        registered_at = _parse_lark_datetime_ms(
            fields.get(F_REGISTERED_AT) or fields.get(F_REGISTERED_AT_FALLBACK)
        )
        checkin_raw = fields.get(F_CHECKIN)
        lark_checkin = _parse_checkin_bool(checkin_raw)
        lark_checksum = _record_checksum(full_name, phone, str(lark_checkin))

        if rid in existing:
            g = existing[rid]
            # Phục hồi nếu bản ghi đã bị soft-delete (vẫn còn lark_record_id)
            g.deleted_at = None
            local_checksum = _record_checksum(g.full_name, g.phone or "", g.checkin_status)
            lark_changed = lark_checksum != local_checksum
            local_changed_after_sync = (
                g.local_updated_at is not None
                and g.last_synced_at is not None
                and g.local_updated_at > g.last_synced_at
            )

            if lark_changed and local_changed_after_sync:
                g.sync_status = SYNC_CONFLICT
                g.sync_error = json.dumps({
                    "local_hash": local_checksum,
                    "lark_hash": lark_checksum,
                    "conflict_at": datetime.now(timezone.utc).isoformat(),
                })
                conflicts += 1
                await _log_sync(
                    db, "lark_to_local", "guest", g.id, rid, SYNC_CONFLICT,
                    error_message="conflict: both sides changed",
                )
            elif lark_changed:
                g.full_name = full_name
                g.phone = phone
                g.business_model = business_model
                g.party_size = party_size
                g.registered_at = registered_at or g.registered_at
                g.checkin_status = "checked_in" if lark_checkin else "not_checked_in"
                g.lark_updated_at = datetime.now(timezone.utc)
                g.last_synced_at = datetime.now(timezone.utc)
                g.sync_status = SYNC_OK
                g.sync_error = None
                pulled += 1
                await _log_sync(
                    db, "lark_to_local", "guest", g.id, rid, SYNC_OK,
                    payload={"fields_updated": ["full_name", "phone", "business_model", "party_size", "checkin_status"]},
                )
        else:
            g = Guest(
                workshop_id=workshop.id,
                full_name=full_name,
                phone=phone,
                business_model=business_model,
                party_size=party_size,
                lark_record_id=rid,
                registered_at=registered_at,
                checkin_status="checked_in" if lark_checkin else "not_checked_in",
                local_updated_at=datetime.now(timezone.utc),
                lark_updated_at=datetime.now(timezone.utc),
                last_synced_at=datetime.now(timezone.utc),
                sync_status=SYNC_OK,
            )
            db.add(g)
            pulled += 1
            await _log_sync(db, "lark_to_local", "guest", None, rid, SYNC_OK)

    await db.commit()
    return {"pulled": pulled, "conflicts": conflicts, "errors": errors}


# -----------------------------------------------------------------
# Push logic (Local → Lark)
# -----------------------------------------------------------------

async def _sync_push_to_lark(db: AsyncSession, workshop_id: uuid.UUID) -> dict:
    """Push unsynced guests (no lark_record_id) to Lark. Returns stats."""
    workshop = await db.get(Workshop, workshop_id)
    if not workshop:
        return {"total": 0, "pushed": 0, "errors": 0, "error_details": []}

    guests = (await db.execute(
        select(Guest).where(
            Guest.workshop_id == workshop_id,
            Guest.lark_record_id.is_(None),
            Guest.deleted_at.is_(None),
        )
    )).scalars().all()

    pushed = errors = 0
    error_details: list[str] = []

    for g in guests:
        try:
            await _push_guest_to_lark(db, g)
            pushed += 1
        except Exception as e:
            errors += 1
            msg = f"{g.full_name}: {e}"
            error_details.append(msg)
            g.sync_status = SYNC_ERROR
            g.sync_error = str(e)
            await _log_sync(db, "local_to_lark", "guest", g.id, None, SYNC_ERROR, error_message=str(e))
            logger.warning("push guest %s to lark failed: %s", g.id, e)

    await db.commit()
    return {"total": len(guests), "pushed": pushed, "errors": errors, "error_details": error_details[:20]}


# -----------------------------------------------------------------
# FastAPI Router endpoints
# -----------------------------------------------------------------

@router.get("/health")
async def lark_health():
    try:
        token = await lark_client.get_tenant_token()
        return {"ok": True, "token_prefix": token[:8] + "..."}
    except Exception as e:
        raise HTTPException(502, f"Lark không kết nối được: {e}")


@router.get("/workshops", dependencies=[Depends(require_permission("lark.read"))])
async def list_lark_workshops():
    if not settings.LARK_TABLE_WORKSHOPS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_WORKSHOPS")
    records = await lark_client.list_records(settings.LARK_TABLE_WORKSHOPS)
    out = []
    seen = set()
    for rec in records:
        f = rec.get("fields", {})
        name = lark_client.field_text(f, WF_NAME)
        if not name or name in seen:
            continue
        seen.add(name)
        et = _parse_time(f.get(WF_DATE), f.get(WF_DATE_TEXT))
        out.append({
            "lark_workshop_name": name,
            "event_date": _parse_date(f.get(WF_DATE)).isoformat() if _parse_date(f.get(WF_DATE)) else None,
            "event_time": et.strftime("%H:%M") if et else None,
            "location": lark_client.field_text(f, WF_LOCATION),
            "branch": lark_client.field_text(f, WF_BRANCH),
        })
    return out


@router.post("/sync/pull", dependencies=[Depends(require_permission("lark.sync"))])
async def sync_pull(
    lark_workshop_name: str,
    target_workshop_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Pull guest updates from Lark Base into local DB."""
    if not settings.LARK_TABLE_REGISTRATIONS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_REGISTRATIONS")
    workshop = await _resolve_workshop(db, lark_workshop_name, target_workshop_id)
    result = await _sync_pull_to_local(db, workshop)
    return {
        "workshop_id": str(workshop.id),
        "workshop_name": workshop.name,
        **result,
    }


@router.post("/sync/push/{workshop_id}", dependencies=[Depends(require_permission("lark.sync"))])
async def sync_push(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Push all guests without lark_record_id to Lark."""
    workshop = await db.get(Workshop, workshop_id)
    if not workshop:
        raise HTTPException(404, "workshop not found")
    result = await _sync_push_to_lark(db, workshop_id)
    return {"workshop_id": str(workshop_id), **result}


@router.post("/sync/push-workshop/{workshop_id}", dependencies=[Depends(require_permission("lark.sync"))])
async def sync_push_workshop(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Đẩy 1 workshop local lên Lark config table (thủ công / backup)."""
    if not settings.LARK_WRITEBACK_ENABLED:
        raise HTTPException(400, "Lark writeback đang tắt (LARK_WRITEBACK_ENABLED=false)")
    if not settings.LARK_TABLE_WORKSHOPS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_WORKSHOPS")
    workshop = await db.get(Workshop, workshop_id)
    if not workshop:
        raise HTTPException(404, "workshop not found")
    try:
        record_id = await _push_workshop_to_lark(db, workshop)
        return {"workshop_id": str(workshop_id), "lark_record_id": record_id, "pushed": True}
    except Exception as e:
        raise HTTPException(502, f"Đẩy workshop lên Lark thất bại: {e}")


@router.post("/sync/full", dependencies=[Depends(require_permission("lark.sync"))])
async def sync_full(
    lark_workshop_name: str,
    target_workshop_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Full bidirectional sync: pull from Lark, then push unsynced to Lark."""
    if not settings.LARK_TABLE_REGISTRATIONS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_REGISTRATIONS")
    workshop = await _resolve_workshop(db, lark_workshop_name, target_workshop_id)
    pull_result = await _sync_pull_to_local(db, workshop)
    # Re-fetch workshop (pull may have created it)
    workshop = (await db.execute(
        select(Workshop).where(Workshop.lark_workshop_name == lark_workshop_name)
    )).scalar_one_or_none()
    if not workshop:
        return {**pull_result, "push": {"total": 0, "pushed": 0, "errors": 0, "error_details": []}}
    push_result = await _sync_push_to_lark(db, workshop.id)
    return {
        "workshop_id": str(workshop.id),
        "workshop_name": workshop.name,
        **pull_result,
        "push": push_result,
    }


@router.post("/sync/workshops", dependencies=[Depends(require_permission("lark.sync"))])
async def sync_workshops(db: AsyncSession = Depends(get_db)):
    """Đồng bộ danh sách workshop từ Lark config table xuống local DB.

    Tạo mới + cập nhật tên/ngày/địa điểm. Fail + báo lỗi nếu slug trùng.
    """
    return await _sync_workshops_from_lark(db)


@router.get("/sync/status", dependencies=[Depends(require_permission("lark.read"))])
async def sync_status(workshop_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db)):
    """Return sync status counts."""
    query = select(func.count(Guest.id), Guest.sync_status)
    if workshop_id:
        query = query.where(Guest.workshop_id == workshop_id, Guest.deleted_at.is_(None))
    else:
        query = query.where(Guest.deleted_at.is_(None))
    rows = (await db.execute(query.group_by(Guest.sync_status))).all()
    counts = {r[1]: r[0] for r in rows}
    last_sync = (await db.execute(select(func.max(SyncLog.created_at)))).scalar_one_or_none()
    return {
        "pending_push": counts.get(SYNC_PENDING_PUSH, 0),
        "conflicts": counts.get(SYNC_CONFLICT, 0),
        "errors": counts.get(SYNC_ERROR, 0),
        "synced": counts.get(SYNC_OK, 0),
        "last_sync_at": last_sync,
    }


@router.post("/sync/resolve/{guest_id}", dependencies=[Depends(require_permission("lark.sync"))])
async def resolve_conflict(
    guest_id: uuid.UUID,
    direction: str,  # 'local' or 'lark'
    db: AsyncSession = Depends(get_db),
):
    """Resolve a sync conflict. direction='local' pushes local to Lark;
    direction='lark' pulls Lark to local, overwriting local.
    """
    if direction not in ("local", "lark"):
        raise HTTPException(400, "direction must be 'local' or 'lark'")

    guest = await db.get(Guest, guest_id)
    if not guest:
        raise HTTPException(404, "guest not found")

    if direction == "lark":
        if not guest.lark_record_id or not settings.LARK_TABLE_REGISTRATIONS:
            raise HTTPException(400, "no lark_record_id to pull from")
        try:
            records = await lark_client.list_records(settings.LARK_TABLE_REGISTRATIONS)
            lark_rec = next(
                (r.get("fields", {}) for r in records if r.get("record_id") == guest.lark_record_id),
                None,
            )
            if not lark_rec:
                raise HTTPException(404, "Lark record not found")
            guest.full_name = lark_client.field_text(lark_rec, F_FULL_NAME) or guest.full_name
            guest.phone = lark_client.field_text(lark_rec, F_PHONE)
            guest.business_model = lark_client.field_text(lark_rec, F_BUSINESS_MODEL)
            guest.party_size = lark_client.field_int(lark_rec, F_TICKETS, default=1)
            checkin_raw = lark_rec.get(F_CHECKIN)
            guest.checkin_status = "checked_in" if _parse_checkin_bool(checkin_raw) else "not_checked_in"
            guest.sync_status = SYNC_OK
            guest.sync_error = None
            guest.lark_updated_at = datetime.now(timezone.utc)
            guest.last_synced_at = datetime.now(timezone.utc)
            await db.commit()
            await _log_sync(db, "lark_to_local", "guest", guest.id, guest.lark_record_id, SYNC_OK)
        except HTTPException:
            raise
        except Exception as e:
            guest.sync_status = SYNC_ERROR
            guest.sync_error = str(e)
            await db.commit()
            return {"guest_id": str(guest_id), "resolved": False, "error": str(e)}
    else:
        try:
            if not guest.lark_record_id:
                await _push_guest_to_lark(db, guest)
            else:
                fields = {
                    F_FULL_NAME: guest.full_name,
                    F_PHONE: guest.phone or "",
                    F_BUSINESS_MODEL: guest.business_model or "",
                    F_TICKETS: max(1, int(guest.party_size or 1)),
                    F_CHECKIN: guest.checkin_status == "checked_in",
                }
                await lark_client.update_record(
                    settings.LARK_TABLE_REGISTRATIONS,
                    guest.lark_record_id,
                    fields,
                )
            guest.sync_status = SYNC_OK
            guest.sync_error = None
            guest.last_synced_at = datetime.now(timezone.utc)
            await db.commit()
            await _log_sync(db, "local_to_lark", "guest", guest.id, guest.lark_record_id, SYNC_OK)
        except Exception as e:
            guest.sync_status = SYNC_ERROR
            guest.sync_error = str(e)
            await db.commit()
            return {"guest_id": str(guest_id), "resolved": False, "error": str(e)}

    await db.refresh(guest)
    return {"guest_id": str(guest_id), "resolved": True, "sync_status": guest.sync_status}


# -----------------------------------------------------------------
# Background Lark polling task
# -----------------------------------------------------------------

_lark_poll_task: asyncio.Task | None = None


async def _lark_poll_once():
    """Poll Lark for all workshops. Each workshop gets a fresh DB session
    so an exception in one workshop doesn't poison the next."""
    from ..db import async_session_maker

    if not settings.LARK_TABLE_REGISTRATIONS:
        return

    try:
        async with async_session_maker() as db:
            workshops = (await db.execute(
                select(Workshop).where(Workshop.lark_workshop_name.is_not(None))
            )).scalars().all()
            workshop_ids = [w.id for w in workshops]
    except Exception as e:
        logger.error("Lark poll error: %s", e)
        return

    for wid in workshop_ids:
        try:
            async with async_session_maker() as db:
                w = await db.get(Workshop, wid)
                if not w:
                    continue
                await _sync_pull_to_local(db, w)
        except Exception as e:
            logger.warning("Lark poll failed for workshop %s: %s", wid, e)


async def _run_lark_poll_loop():
    global _lark_poll_task
    while True:
        await asyncio.sleep(SYNC_INTERVAL)
        try:
            await _lark_poll_once()
        except Exception as e:
            logger.error("Lark poll loop error: %s", e)


def start_lark_poll():
    global _lark_poll_task
    if _lark_poll_task is None or _lark_poll_task.done():
        _lark_poll_task = asyncio.create_task(_run_lark_poll_loop())
        logger.info("Lark poll background task started (interval=%ds)", SYNC_INTERVAL)


def stop_lark_poll():
    global _lark_poll_task
    if _lark_poll_task:
        _lark_poll_task.cancel()
        _lark_poll_task = None
        logger.info("Lark poll background task stopped")
