"""Lưu ảnh catalog/survey: chuyển sang WebP 2 cỡ (thẻ + gallery) theo yêu cầu ảnh của thiết kế."""
import io
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import settings

ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp"}
MAX_CATALOG_IMAGE_BYTES = 25 * 1024 * 1024
FULL_LONG_EDGE = 1080
THUMB_WIDTH = 480
Image.MAX_IMAGE_PIXELS = 60_000_000


@dataclass
class StoredImage:
    file_url: str
    thumb_url: str
    width: int
    height: int


def _encode(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality, method=6)
    return buf.getvalue()


async def store_image(upload: UploadFile, subdir: str) -> StoredImage:
    mime = (upload.content_type or "").lower()
    if mime not in ALLOWED_IMAGE_MIMES:
        raise HTTPException(400, f"{upload.filename}: chỉ nhận ảnh JPG, PNG hoặc WebP.")
    data = await upload.read()
    if not data:
        raise HTTPException(400, f"{upload.filename}: file rỗng.")
    if len(data) > MAX_CATALOG_IMAGE_BYTES:
        raise HTTPException(400, f"{upload.filename}: ảnh vượt quá 25 MB.")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, f"{upload.filename}: không đọc được ảnh.") from exc
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")

    full = img.copy()
    full.thumbnail((FULL_LONG_EDGE, FULL_LONG_EDGE), Image.Resampling.LANCZOS)
    thumb = img.copy()
    thumb.thumbnail((THUMB_WIDTH, THUMB_WIDTH * 2), Image.Resampling.LANCZOS)

    target = Path(settings.UPLOAD_DIR) / subdir
    target.mkdir(parents=True, exist_ok=True)
    stem = uuid.uuid4().hex
    (target / f"{stem}.webp").write_bytes(_encode(full, 82))
    (target / f"{stem}_t.webp").write_bytes(_encode(thumb, 76))
    return StoredImage(
        file_url=f"/uploads/{subdir}/{stem}.webp",
        thumb_url=f"/uploads/{subdir}/{stem}_t.webp",
        width=full.width,
        height=full.height,
    )


def delete_stored(*urls: str | None) -> None:
    for url in urls:
        if not url or not url.startswith("/uploads/"):
            continue
        path = Path(settings.UPLOAD_DIR) / url[len("/uploads/"):]
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            pass
