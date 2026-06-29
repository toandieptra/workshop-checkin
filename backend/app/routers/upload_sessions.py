import os
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..config import settings
from ..models import UploadSession
from ..schemas import (
    UploadSessionCreate, UploadSessionOut, UploadImagesResponse, UploadImageItem,
)

router = APIRouter(tags=["upload-sessions"])

ALLOWED_MIMES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"}
ALLOWED_EXTS = {"jpg", "jpeg", "png", "webp", "heic", "heif"}


def _now():
    return datetime.now(timezone.utc)


def _is_expired(s: UploadSession) -> bool:
    return s.expires_at.replace(tzinfo=timezone.utc) < _now()


def _build_base_url(request: Request) -> str:
    if settings.PUBLIC_BASE_URL:
        return settings.PUBLIC_BASE_URL.rstrip("/")
    return str(request.base_url).rstrip("/")


def _to_out(s: UploadSession, request: Request, include_token: bool = False) -> dict:
    base = _build_base_url(request)
    upload_url = f"{base}/m/{s.id}"
    out = {
        "id": s.id,
        "status": s.status,
        "images": s.images or [],
        "max_files": s.max_files,
        "expires_at": s.expires_at,
        "upload_url": upload_url,
    }
    if include_token:
        out["token"] = s.token
    return out


async def _load(db: AsyncSession, sid: uuid.UUID) -> UploadSession:
    s = await db.get(UploadSession, sid)
    if not s:
        raise HTTPException(404, "session not found")
    return s


async def _verify(db: AsyncSession, sid: uuid.UUID, token: str) -> UploadSession:
    s = await _load(db, sid)
    if s.token != token:
        raise HTTPException(404, "session not found")
    if s.status == "closed":
        raise HTTPException(410, "session closed")
    if s.status == "expired" or _is_expired(s):
        # lazy mark
        s.status = "expired"
        await db.commit()
        raise HTTPException(410, "session expired")
    return s


@router.post("/api/upload-sessions", status_code=201)
async def create_session(
    body: UploadSessionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    s = UploadSession(
        token=secrets.token_hex(24),
        status="open",
        images=[],
        max_files=body.max_files,
        subfolder=body.subfolder or "qr-upload",
        expires_at=_now() + timedelta(seconds=body.ttl_seconds),
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _to_out(s, request, include_token=True)


@router.get("/api/upload-sessions/{sid}")
async def get_session(
    sid: uuid.UUID,
    request: Request,
    t: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    s = await _verify(db, sid, t)
    if _is_expired(s):
        s.status = "expired"
        await db.commit()
    return _to_out(s, request, include_token=False)


@router.post("/api/upload-sessions/{sid}/close")
async def close_session(
    sid: uuid.UUID,
    t: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    s = await _verify(db, sid, t)
    s.status = "closed"
    await db.commit()
    return {"ok": True}


@router.post("/api/upload-sessions/{sid}/images", response_model=UploadImagesResponse)
async def upload_images(
    sid: uuid.UUID,
    t: str = Query(...),
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    s = await _verify(db, sid, t)

    images: list = list(s.images or [])
    items: list[UploadImageItem] = []
    errors: list[str] = []

    for f in files:
        if len(images) >= s.max_files:
            errors.append(f"{f.filename}: session full ({s.max_files} files)")
            break
        mime = (f.content_type or "").lower()
        ext = os.path.splitext(f.filename or "")[1].lstrip(".").lower()
        if mime not in ALLOWED_MIMES and ext not in ALLOWED_EXTS:
            errors.append(f"{f.filename}: mime {mime} not allowed")
            continue
        data = await f.read()
        if len(data) > settings.MAX_UPLOAD_FILE_BYTES:
            errors.append(f"{f.filename}: too large ({len(data)} bytes)")
            continue
        if len(data) == 0:
            errors.append(f"{f.filename}: empty file")
            continue

        sub = (s.subfolder or "qr-upload").strip("/")
        target_dir = Path(settings.UPLOAD_DIR) / sub
        target_dir.mkdir(parents=True, exist_ok=True)
        out_ext = ext if ext in ALLOWED_EXTS else "jpg"
        fname = f"{uuid.uuid4().hex}.{out_ext}"
        (target_dir / fname).write_bytes(data)
        url = f"/uploads/{sub}/{fname}"

        item = {"url": url, "name": f.filename or fname, "size": len(data), "mime": mime or f"image/{out_ext}", "ts": _now().isoformat()}
        images.append(item)
        items.append(UploadImageItem(url=url, name=item["name"], size=item["size"], mime=item["mime"]))

    s.images = images
    await db.commit()
    return UploadImagesResponse(items=items, errors=errors)


# Trang mobile - HTML self-contained (Tailwind CDN, vanilla JS)
MOBILE_HTML = """<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Upload ảnh — Hi Sweetie VN</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{font-family:system-ui,-apple-system,sans-serif}</style>
</head><body class="min-h-screen bg-slate-50">
<div class="max-w-md mx-auto p-4">
  <div class="text-[10px] tracking-widest font-semibold text-cyan-600">HI SWEETIE VIỆT NAM</div>
  <h1 class="text-xl font-bold text-slate-800 mb-1">Upload ảnh</h1>
  <div class="text-xs text-slate-500 mb-4">Phiên hết hạn lúc <span id="exp" class="font-medium"></span></div>

  <label class="block">
    <div class="w-full border-2 border-dashed border-slate-300 rounded-lg p-6 text-center bg-white cursor-pointer active:bg-slate-50">
      <div class="text-3xl mb-2">📷</div>
      <div class="font-medium text-slate-700">Chọn ảnh từ thư viện / chụp</div>
      <div class="text-xs text-slate-500 mt-1">JPEG, PNG, WebP, HEIC</div>
    </div>
    <input id="file" type="file" accept="image/*" multiple capture="environment" class="hidden">
  </label>

  <div id="previews" class="grid grid-cols-3 gap-2 mt-4"></div>

  <div id="status" class="mt-4 text-sm text-slate-600"></div>

  <button id="send" class="mt-4 w-full bg-cyan-600 text-white font-semibold py-3 rounded-lg disabled:opacity-40" disabled>
    Gửi ảnh
  </button>

  <div id="result" class="mt-4"></div>
</div>
<script>
const SID = "__SID__";
const TOK = "__TOK__";
const EXP = "__EXP__";

document.getElementById("exp").textContent = new Date(EXP).toLocaleTimeString("vi-VN");

const fileInput = document.getElementById("file");
const previewsEl = document.getElementById("previews");
const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
let chosen = [];

fileInput.addEventListener("change", () => {
  chosen = Array.from(fileInput.files || []);
  previewsEl.innerHTML = "";
  chosen.forEach(f => {
    const url = URL.createObjectURL(f);
    const img = document.createElement("img");
    img.src = url; img.className = "w-full h-24 object-cover rounded border";
    previewsEl.appendChild(img);
  });
  sendBtn.disabled = chosen.length === 0;
  sendBtn.textContent = `Gửi ${chosen.length} ảnh`;
});

sendBtn.addEventListener("click", async () => {
  if (!chosen.length) return;
  sendBtn.disabled = true;
  statusEl.textContent = "Đang upload...";
  const fd = new FormData();
  chosen.forEach(f => fd.append("files", f));
  try {
    const res = await fetch(`/api/upload-sessions/${SID}/images?t=${encodeURIComponent(TOK)}`, {
      method: "POST", body: fd
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);
    statusEl.textContent = "";
    resultEl.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
      ✅ Đã gửi <b>${data.items.length}</b> ảnh
      ${data.errors.length ? `<div class="text-red-600 mt-1">Lỗi: ${data.errors.join("; ")}</div>` : ""}
    </div>`;
    chosen = []; fileInput.value = "";
    previewsEl.innerHTML = "";
  } catch (e) {
    statusEl.textContent = "";
    resultEl.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">❌ ${e.message}</div>`;
    sendBtn.disabled = false;
  }
});
</script>
</body></html>"""


@router.get("/m/{sid}", response_class=HTMLResponse)
async def mobile_page(sid: uuid.UUID, t: str = Query(...), db: AsyncSession = Depends(get_db)):
    s = await _verify(db, sid, t)
    html = (MOBILE_HTML
            .replace("__SID__", str(s.id))
            .replace("__TOK__", s.token)
            .replace("__EXP__", s.expires_at.isoformat()))
    return HTMLResponse(html)
