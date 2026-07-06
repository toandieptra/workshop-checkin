import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Guest, Workshop

router = APIRouter(prefix="/api", tags=["import-export"])

COLS = ["full_name", "phone", "email", "business_model", "role_title", "guest_type"]


def _parse_int(v, default: int = 1) -> int:
    try:
        n = int(float(str(v).strip()))
        return n if n > 0 else default
    except (TypeError, ValueError):
        return default


@router.post("/workshops/{workshop_id}/import")
async def import_guests(workshop_id: uuid.UUID, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    w = await db.get(Workshop, workshop_id)
    if not w:
        raise HTTPException(404, "workshop not found")
    data = await file.read()
    name = (file.filename or "").lower()

    rows: list[dict] = []
    if name.endswith(".xlsx") or name.endswith(".xls"):
        wb = load_workbook(io.BytesIO(data), read_only=True)
        ws = wb.active
        headers = [str(c.value).strip().lower() if c.value else "" for c in next(ws.iter_rows(min_row=1, max_row=1))]
        for r in ws.iter_rows(min_row=2, values_only=True):
            rows.append({headers[i]: r[i] for i in range(len(headers)) if i < len(r)})
    else:
        text = data.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        rows = [{(k or "").strip().lower(): v for k, v in row.items()} for row in reader]

    created = 0
    for row in rows:
        full_name = (row.get("full_name") or row.get("ten") or "").strip()
        if not full_name:
            continue
        g = Guest(
            workshop_id=workshop_id,
            full_name=full_name,
            phone=(row.get("phone") or None),
            email=(row.get("email") or None),
            business_model=(row.get("business_model") or row.get("mô hình kinh doanh") or row.get("mo hinh kinh doanh") or None),
            registered_at=datetime.now(timezone.utc),
            role_title=(row.get("role_title") or None),
            guest_type=(row.get("guest_type") or None),
            party_size=_parse_int(
                row.get("party_size") or row.get("so_khach") or row.get("số khách")
                or row.get("số vé đăng ký") or row.get("so ve") or 1
            ),
        )
        db.add(g)
        created += 1
    await db.commit()
    return {"imported": created, "total_rows": len(rows)}


@router.get("/workshops/{workshop_id}/export")
async def export_guests(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Xuất toàn bộ khách của workshop (mọi trạng thái) kèm thông tin & trạng thái check-in/đồng bộ."""
    rows = (await db.execute(
        select(Guest).where(
            Guest.workshop_id == workshop_id,
            Guest.deleted_at.is_(None),
        ).order_by(Guest.checkin_status.desc(), Guest.full_name)
    )).scalars().all()

    def _fmt(dt):
        return dt.isoformat() if dt else ""

    def _checkin_label(status: str | None) -> str:
        return "Đã check-in" if status == "checked_in" else "Chưa check-in"

    def _sync_label(status: str | None) -> str:
        return {
            "synced": "Đã đồng bộ",
            "pending_push": "Chờ đồng bộ",
            "conflict": "Xung đột",
            "error": "Lỗi đồng bộ",
        }.get(status or "", status or "")

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "full_name", "phone", "email", "company", "business_model",
        "role_title", "guest_type", "party_size", "note",
        "checkin_status", "checked_in_at",
        "sync_status", "lark_record_id",
        "registered_at", "created_at",
    ])
    for g in rows:
        writer.writerow([
            g.full_name,
            g.phone or "",
            g.email or "",
            g.company or "",
            g.business_model or "",
            g.role_title or "",
            g.guest_type or "",
            g.party_size,
            g.note or "",
            _checkin_label(g.checkin_status),
            _fmt(g.checked_in_at),
            _sync_label(g.sync_status),
            g.lark_record_id or "",
            _fmt(g.registered_at),
            _fmt(g.created_at),
        ])
    buf.seek(0)
    fname = f"guests_{workshop_id}_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    # BOM để Excel mở UTF-8 (tiếng Việt) đúng
    content = "\ufeff" + buf.getvalue()
    return StreamingResponse(
        iter([content]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )
