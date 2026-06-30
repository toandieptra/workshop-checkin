import os
import uuid
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..config import settings
from ..models import Guest, FaceProfile
from ..schemas import GuestOut, GuestUpdate, FaceProfileOut
from ..services.face_client import get_embedding

router = APIRouter(prefix="/api", tags=["guests"])


async def _load_guest(db: AsyncSession, guest_id: uuid.UUID) -> Guest:
    g = (
        await db.execute(
            select(Guest).options(selectinload(Guest.face_profiles)).where(Guest.id == guest_id)
        )
    ).scalar_one_or_none()
    if not g:
        raise HTTPException(404, "guest not found")
    return g


@router.get("/guests/{guest_id}", response_model=GuestOut)
async def get_guest(guest_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await _load_guest(db, guest_id)


@router.patch("/guests/{guest_id}", response_model=GuestOut)
async def update_guest(guest_id: uuid.UUID, body: GuestUpdate, db: AsyncSession = Depends(get_db)):
    g = await _load_guest(db, guest_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(g, k, v)
    await db.commit()
    return await _load_guest(db, guest_id)


@router.delete("/guests/{guest_id}", status_code=204)
async def delete_guest(guest_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    g = await db.get(Guest, guest_id)
    if not g:
        raise HTTPException(404, "guest not found")
    await db.delete(g)
    await db.commit()


@router.post("/guests/{guest_id}/face-images", response_model=FaceProfileOut, status_code=201)
async def upload_face_image(guest_id: uuid.UUID, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    g = await _load_guest(db, guest_id)
    if not g.consent_face_recognition:
        raise HTTPException(403, "guest did not consent to face recognition")

    # quota chi ap dung cho anh tham chieu (admin/QR upload),
    # anh check-in (snapshot) tu camera khong tinh vao gioi han nay
    n_ref = (await db.execute(
        select(func.count(FaceProfile.id))
        .where(FaceProfile.guest_id == guest_id, FaceProfile.source == "reference")
    )).scalar_one()
    if n_ref >= settings.MAX_FACE_IMAGES_PER_GUEST:
        raise HTTPException(
            422,
            f"guest already has {n_ref}/{settings.MAX_FACE_IMAGES_PER_GUEST} reference images",
        )

    data = await file.read()
    res = await get_embedding(data, file.filename or "face.jpg")
    if not res.get("success"):
        raise HTTPException(422, res.get("error", "no_face"))

    face = res["faces"][0]
    quality = float(face.get("quality_score", 0))
    if quality < settings.MIN_QUALITY_SCORE:
        raise HTTPException(422, f"quality too low ({quality:.2f} < {settings.MIN_QUALITY_SCORE})")

    # luu file
    faces_dir = os.path.join(settings.UPLOAD_DIR, "guest-faces")
    os.makedirs(faces_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1] or ".jpg"
    fname = f"{guest_id}_{uuid.uuid4().hex}{ext}"
    with open(os.path.join(faces_dir, fname), "wb") as fh:
        fh.write(data)
    image_url = f"/uploads/guest-faces/{fname}"

    fp = FaceProfile(
        guest_id=guest_id,
        image_url=image_url,
        embedding=face["embedding"],
        quality_score=quality,
        is_active=True,
        source="reference",
    )
    db.add(fp)
    await db.commit()
    await db.refresh(fp)
    return fp


@router.delete(
    "/guests/{guest_id}/face-images/{face_image_id}",
    status_code=204,
)
async def delete_face_image(
    guest_id: uuid.UUID,
    face_image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    fp = await db.get(FaceProfile, face_image_id)
    if not fp or fp.guest_id != guest_id:
        raise HTTPException(404, "face image not found")

    if fp.image_url:
        rel = fp.image_url.lstrip("/").removeprefix("uploads/")
        path = os.path.join(settings.UPLOAD_DIR, rel)
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError as e:
                import logging
                logging.getLogger("guests").warning("Không xóa được file %s: %s", path, e)

    await db.delete(fp)
    await db.commit()


@router.post("/guests/{guest_id}/generate-embedding", response_model=GuestOut)
async def generate_embedding(guest_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """No-op tien ich: embedding da duoc tao luc upload anh. Tra ve guest hien tai."""
    return await _load_guest(db, guest_id)
