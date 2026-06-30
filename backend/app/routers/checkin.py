import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..config import settings
from ..models import Guest, FaceProfile, CheckinLog, WelcomeEvent
from ..schemas import RecognizeResult, ConfirmRequest, ManualCheckinRequest, ResendRequest, ResetRequest, GuestOut
from ..services.face_client import get_embedding
from ..services import lark_client
from ..redis_client import is_duplicate, mark_checked_in, clear_dedup
from ..ws import manager

logger = logging.getLogger("checkin")
router = APIRouter(prefix="/api/checkin", tags=["checkin"])


def _now():
    return datetime.now(timezone.utc)


async def _guest_with_faces(db: AsyncSession, guest_id) -> Guest | None:
    return (
        await db.execute(
            select(Guest).options(selectinload(Guest.face_profiles)).where(Guest.id == guest_id)
        )
    ).scalar_one_or_none()


async def _save_snapshot(data: bytes, filename: str) -> str | None:
    if not settings.SAVE_CHECKIN_SNAPSHOTS:
        return None
    snap_dir = os.path.join(settings.UPLOAD_DIR, "snapshots")
    os.makedirs(snap_dir, exist_ok=True)
    ext = os.path.splitext(filename)[1] or ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(snap_dir, fname), "wb") as fh:
        fh.write(data)
    return f"/uploads/snapshots/{fname}"


async def _save_checkin_face(db: AsyncSession, guest_id, embedding, data: bytes, ext: str):
    """Lưu ảnh check-in vào face_profiles (source='checkin') làm tham chiếu.

    Enforce rolling window: chi giu toi da MAX_CHECKIN_SNAPSHOTS_PER_GUEST (2)
    anh moi nhat; row cu nhat (theo created_at) bi xoa ca DB record lan file.
    """
    faces_dir = os.path.join(settings.UPLOAD_DIR, "guest-faces")
    os.makedirs(faces_dir, exist_ok=True)
    fname = f"{guest_id}_chk_{uuid.uuid4().hex}{ext}"
    fpath = os.path.join(faces_dir, fname)
    with open(fpath, "wb") as fh:
        fh.write(data)
    image_url = f"/uploads/guest-faces/{fname}"

    fp = FaceProfile(
        guest_id=guest_id,
        image_url=image_url,
        embedding=embedding,
        quality_score=None,
        is_active=True,
        source="checkin",
    )
    db.add(fp)
    await db.flush()  # dam bao co created_at de ordering rolling window

    cap = settings.MAX_CHECKIN_SNAPSHOTS_PER_GUEST
    excess = (await db.execute(
        text("""
            SELECT id, image_url FROM face_profiles
            WHERE guest_id = :gid AND source = 'checkin'
            ORDER BY created_at DESC
            OFFSET :cap
        """),
        {"gid": str(guest_id), "cap": cap},
    )).all()
    for old_id, old_url in excess:
        if old_url:
            rel = old_url.lstrip("/").removeprefix("uploads/")
            path = os.path.join(settings.UPLOAD_DIR, rel)
            if os.path.exists(path):
                try:
                    os.remove(path)
                except OSError as e:
                    logger.warning("Khong xoa duoc file checkin %s: %s", path, e)
        await db.execute(text("DELETE FROM face_profiles WHERE id = :id"), {"id": str(old_id)})
    return fp


async def _broadcast_welcome(db: AsyncSession, workshop_id, guest: Guest):
    name = guest.full_name
    msg = "Hi Sweetie Việt Nam rất vui được đón tiếp anh/chị"
    we = WelcomeEvent(
        workshop_id=workshop_id, guest_id=guest.id,
        display_name=name, display_message=msg, event_type="welcome",
    )
    db.add(we)
    await db.commit()
    await manager.broadcast({
        "type": "welcome",
        "workshop_id": str(workshop_id),
        "guest_id": str(guest.id),
        "display_name": name,
        "display_message": msg,
    })


@router.post("/recognize", response_model=RecognizeResult)
async def recognize(
    workshop_id: uuid.UUID = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    data = await file.read()
    res = await get_embedding(data, file.filename or "frame.jpg")
    if not res.get("success"):
        return RecognizeResult(decision="no_face", message="Không phát hiện khuôn mặt")

    face = res["faces"][0]
    emb = face["embedding"]
    quality = float(face.get("quality_score", 0))
    snapshot_url = await _save_snapshot(data, file.filename or "frame.jpg")

    # tim guest gan nhat trong workshop bang cosine distance pgvector
    emb_str = "[" + ",".join(str(x) for x in emb) + "]"
    row = (await db.execute(text("""
        SELECT g.id AS guest_id, 1 - (fp.embedding <=> :emb) AS similarity
        FROM face_profiles fp
        JOIN guests g ON g.id = fp.guest_id
        WHERE g.workshop_id = :wid AND fp.is_active = true
          AND g.consent_face_recognition = true
        ORDER BY fp.embedding <=> :emb
        LIMIT 1
    """), {"emb": emb_str, "wid": str(workshop_id)})).first()

    if row is None:
        log = CheckinLog(workshop_id=workshop_id, method="face", similarity=None,
                         snapshot_url=snapshot_url, status="rejected")
        db.add(log)
        await db.commit()
        return RecognizeResult(decision="reject", quality_score=quality,
                               message="Không tìm thấy khách phù hợp, vui lòng tìm thủ công",
                               log_id=log.id)

    similarity = float(row.similarity)
    guest = await _guest_with_faces(db, row.guest_id)

    # luu anh check-in thanh cong lam tham chieu (rolling 2 anh moi nhat)
    # ap dung cho ca duplicate/confirm/auto — moi lan match that la 1 lan "check-in thuc te"
    ext = os.path.splitext(file.filename or "")[1] or ".jpg"
    await _save_checkin_face(db, guest.id, emb, data, ext)

    # nguong thap -> khong nhan
    if similarity < settings.REJECT_THRESHOLD:
        log = CheckinLog(workshop_id=workshop_id, guest_id=None, method="face",
                         similarity=similarity, snapshot_url=snapshot_url, status="rejected")
        db.add(log)
        await db.commit()
        return RecognizeResult(decision="reject", similarity=similarity, quality_score=quality,
                               message="Không nhận diện được, vui lòng tìm thủ công", log_id=log.id)

    # da check-in roi -> duplicate (Redis dedup)
    if await is_duplicate(workshop_id, guest.id):
        log = CheckinLog(workshop_id=workshop_id, guest_id=guest.id, method="face",
                         similarity=similarity, snapshot_url=snapshot_url, status="duplicate")
        db.add(log)
        await db.commit()
        return RecognizeResult(decision="duplicate", similarity=similarity, quality_score=quality,
                               guest=GuestOut.model_validate(guest),
                               message=f"{guest.full_name} đã check-in", log_id=log.id)

    # nguong trung binh -> bat staff confirm
    if similarity < settings.AUTO_CHECKIN_THRESHOLD:
        log = CheckinLog(workshop_id=workshop_id, guest_id=guest.id, method="face",
                         similarity=similarity, snapshot_url=snapshot_url, status="candidate")
        db.add(log)
        await db.commit()
        return RecognizeResult(decision="confirm", similarity=similarity, quality_score=quality,
                               guest=GuestOut.model_validate(guest),
                               message=f"Có thể là {guest.full_name}? Vui lòng xác nhận", log_id=log.id)

    # sim >= auto threshold
    if settings.ENABLE_STAFF_CONFIRMATION:
        log = CheckinLog(workshop_id=workshop_id, guest_id=guest.id, method="face",
                         similarity=similarity, snapshot_url=snapshot_url, status="candidate")
        db.add(log)
        await db.commit()
        return RecognizeResult(decision="confirm", similarity=similarity, quality_score=quality,
                               guest=GuestOut.model_validate(guest),
                               message=f"{guest.full_name} — xác nhận check-in?", log_id=log.id)

    # auto check-in (khong yeu cau confirm)
    lark_err = await _do_checkin(db, workshop_id, guest, "face", similarity, snapshot_url)
    msg = f"Đã check-in {guest.full_name}"
    if lark_err:
        msg += f" (Lỗi Lark: {lark_err})"
    return RecognizeResult(decision="auto", similarity=similarity, quality_score=quality,
                           guest=GuestOut.model_validate(guest),
                           message=msg)


async def _lark_writeback(guest: Guest) -> str | None:
    """Tick Check-In=true trên Lark. Thử "Check-In" trước, nếu lỗi thì thử "Check-in"."""
    if not settings.LARK_WRITEBACK_ENABLED:
        return None
    if not guest.lark_record_id or not settings.LARK_TABLE_REGISTRATIONS:
        return None
    try:
        await lark_client.update_record(
            settings.LARK_TABLE_REGISTRATIONS,
            guest.lark_record_id,
            {"Check-In": True},
        )
        return None
    except Exception as e1:
        try:
            await lark_client.update_record(
                settings.LARK_TABLE_REGISTRATIONS,
                guest.lark_record_id,
                {"Check-in": True},
            )
            return None
        except Exception as e2:
            logger.warning("lark writeback failed for guest %s: %s (Check-In) and %s (Check-in)", guest.id, e1, e2)
            return f"{e1} / {e2}"


async def _do_checkin(db, workshop_id, guest: Guest, method, similarity, snapshot_url,
                      feedback=None, broadcast=True):
    guest.checkin_status = "checked_in"
    guest.checked_in_at = _now()
    log = CheckinLog(workshop_id=workshop_id, guest_id=guest.id, method=method,
                     similarity=similarity, snapshot_url=snapshot_url, status="checked_in",
                     staff_feedback=feedback, checked_in_at=_now())
    db.add(log)
    await db.commit()
    await mark_checked_in(workshop_id, guest.id)
    lark_err = await _lark_writeback(guest)
    if broadcast:
        await _broadcast_welcome(db, workshop_id, guest)
    return lark_err


@router.post("/confirm", response_model=RecognizeResult)
async def confirm(body: ConfirmRequest, db: AsyncSession = Depends(get_db)):
    guest = await _guest_with_faces(db, body.guest_id)
    if not guest:
        raise HTTPException(404, "guest not found")

    if body.feedback == "wrong":
        # staff bao sai khach -> log feedback, khong check-in
        log = CheckinLog(workshop_id=body.workshop_id, guest_id=body.guest_id, method="face",
                         similarity=body.similarity, status="rejected", staff_feedback="wrong")
        db.add(log)
        await db.commit()
        return RecognizeResult(decision="reject", similarity=body.similarity,
                               message="Đã ghi nhận sai khách")

    if await is_duplicate(body.workshop_id, body.guest_id):
        return RecognizeResult(decision="duplicate", guest=GuestOut.model_validate(guest),
                               message=f"{guest.full_name} đã check-in")

    lark_err = await _do_checkin(db, body.workshop_id, guest, "face", body.similarity, None, feedback="correct")
    msg = f"Đã check-in {guest.full_name}"
    if lark_err:
        msg += f" (Lỗi Lark: {lark_err})"
    return RecognizeResult(decision="auto", similarity=body.similarity,
                           guest=GuestOut.model_validate(guest),
                           message=msg)


@router.post("/manual", response_model=RecognizeResult)
async def manual_checkin(body: ManualCheckinRequest, db: AsyncSession = Depends(get_db)):
    guest = await _guest_with_faces(db, body.guest_id)
    if not guest:
        raise HTTPException(404, "guest not found")
    if await is_duplicate(body.workshop_id, body.guest_id):
        return RecognizeResult(decision="duplicate", guest=GuestOut.model_validate(guest),
                               message=f"{guest.full_name} đã check-in")
    lark_err = await _do_checkin(db, body.workshop_id, guest, body.method, None, None)
    msg = f"Đã check-in {guest.full_name}"
    if lark_err:
        msg += f" (Lỗi Lark: {lark_err})"
    return RecognizeResult(decision="auto", guest=GuestOut.model_validate(guest),
                           message=msg)



@router.post("/manual", response_model=RecognizeResult)
async def manual_checkin(body: ManualCheckinRequest, db: AsyncSession = Depends(get_db)):
    guest = await _guest_with_faces(db, body.guest_id)
    if not guest:
        raise HTTPException(404, "guest not found")
    if await is_duplicate(body.workshop_id, body.guest_id):
        return RecognizeResult(decision="duplicate", guest=GuestOut.model_validate(guest),
                               message=f"{guest.full_name} đã check-in")
    await _do_checkin(db, body.workshop_id, guest, body.method, None, None)
    return RecognizeResult(decision="auto", guest=GuestOut.model_validate(guest),
                           message=f"Đã check-in {guest.full_name}")


@router.post("/resend-welcome", response_model=RecognizeResult)
async def resend_welcome(body: ResendRequest, db: AsyncSession = Depends(get_db)):
    guest = await _guest_with_faces(db, body.guest_id)
    if not guest:
        raise HTTPException(404, "guest not found")
    await _broadcast_welcome(db, body.workshop_id, guest)
    return RecognizeResult(decision="auto", guest=GuestOut.model_validate(guest),
                           message=f"Đã gửi lại lời chào cho {guest.full_name}")


@router.post("/reset", response_model=GuestOut)
async def reset_checkin(body: ResetRequest, db: AsyncSession = Depends(get_db)):
    guest = await _guest_with_faces(db, body.guest_id)
    if not guest:
        raise HTTPException(404, "guest not found")
    guest.checkin_status = "not_checked_in"
    guest.checked_in_at = None
    await db.commit()
    await clear_dedup(guest.workshop_id, guest.id)
    return await _guest_with_faces(db, body.guest_id)


@router.get("/logs")
async def get_logs(workshop_id: uuid.UUID, limit: int = 100, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(CheckinLog).where(CheckinLog.workshop_id == workshop_id)
        .order_by(CheckinLog.created_at.desc()).limit(limit)
    )).scalars().all()
    return [
        {
            "id": str(r.id), "guest_id": str(r.guest_id) if r.guest_id else None,
            "method": r.method, "similarity": r.similarity, "status": r.status,
            "staff_feedback": r.staff_feedback, "snapshot_url": r.snapshot_url,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@router.get("/welcome/latest")
async def get_latest_welcome(db: AsyncSession = Depends(get_db)):
    stmt = select(WelcomeEvent).order_by(WelcomeEvent.created_at.desc())
    row = (await db.execute(stmt.limit(1))).scalar_one_or_none()
    if not row:
        return None
    return {
        "id": str(row.id),
        "workshop_id": str(row.workshop_id),
        "guest_id": str(row.guest_id) if row.guest_id else None,
        "display_name": row.display_name,
        "display_message": row.display_message,
        "created_at": row.created_at,
    }

