"""Quản lý block Smax (Zalo User) trong Cài đặt → Tin nhắn Zalo, và token đăng nhập web Smax."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import current_user, require_any_permission, require_permission
from ..config import settings
from ..db import get_db
from ..models import AdminUser, SmaxCredential
from ..services import smax, smax_blocks

router = APIRouter(prefix="/api/smax", tags=["smax-blocks"])
READ = Depends(require_any_permission("zalo_templates.read", "zalo_messages.send", "zalo_messages.bulk_send"))
WRITE = Depends(require_any_permission("zalo_templates.create", "zalo_templates.edit", "zalo_templates.manage"))
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def _err(exc: Exception) -> HTTPException:
    if isinstance(exc, smax.SmaxRejected):
        return HTTPException(409, str(exc))
    return HTTPException(502, str(exc))


def _block_out(b: dict, folders: dict[str, str] | None = None) -> dict:
    cards = [smax_blocks.card_view(c) for c in smax_blocks.message_cards(b)] if "cards" in b else None
    return {"id": b.get("id"), "name": b.get("name") or "", "group_id": b.get("group_id"),
            "folder": (folders or {}).get(b.get("group_id") or "", None), "updated_at": b.get("updated_at"),
            "messages": cards, "other_cards": len([c for c in (b.get("cards") or []) if c.get("type") != smax_blocks.CARD_TYPE])}


@router.get("/status", dependencies=[READ])
async def status(db: AsyncSession = Depends(get_db)):
    token = await smax_blocks.user_token(db)
    exp = smax_blocks.token_expiry(token)
    row = await db.get(SmaxCredential, 1)
    return {"configured": smax.configured(), "biz": settings.SMAX_BIZ_ALIAS if smax.configured() else None,
            "user_token": bool(token), "user_token_expires_at": exp,
            "user_token_expired": bool(exp and exp < datetime.now(timezone.utc)),
            "user_token_source": "db" if row and row.user_token else ("env" if settings.SMAX_USER_TOKEN else None),
            "api_token_source": smax.api_token_source()}


class TokenBody(BaseModel):
    token: str = Field(min_length=20, max_length=4000)


TOKEN_KINDS = {"api": "Partner API token", "user": "Token đăng nhập Smax"}
CONN_READ = Depends(require_any_permission("zalo_connections.read", "zalo_connections.manage"))
CONN_MANAGE = Depends(require_permission("zalo_connections.manage"))


def _clean(token: str) -> str:
    return token.strip().removeprefix("Bearer ").strip()


def _mask(token: str | None) -> str | None:
    return f"••••••••{token[-4:]}" if token and len(token) > 8 else None


async def _probe(db: AsyncSession, kind: str, token: str) -> None:
    """Gọi thử Smax bằng token — lỗi thì raise (SmaxRejected/SmaxError)."""
    if kind == "api":
        await smax._request("GET", "/pages", token=token)
    else:
        await smax_blocks._internal(db, "GET", "/groups?type=BLOCK", token=token)


async def _token_info(db: AsyncSession, kind: str, row: SmaxCredential | None, *, check: bool = False) -> dict:
    if kind == "api":
        db_tok, env_tok = (row.api_token if row else None), settings.SMAX_API_TOKEN
        by, at = (row.api_token_updated_by, row.api_token_updated_at) if row else (None, None)
    else:
        db_tok, env_tok = (row.user_token if row else None), settings.SMAX_USER_TOKEN
        by, at = (row.updated_by, row.updated_at) if row else (None, None)
    token = db_tok or env_tok
    exp = smax_blocks.token_expiry(token) if token else None
    now = datetime.now(timezone.utc)
    info = {"kind": kind, "label": TOKEN_KINDS[kind], "configured": bool(token),
            "source": "db" if db_tok else ("env" if env_tok else None), "masked": _mask(token),
            "expires_at": exp, "expired": bool(exp and exp < now),
            "expires_soon": bool(exp and now <= exp and (exp - now).total_seconds() < 3 * 86400),
            "updated_at": at if db_tok else None, "updated_by": None, "has_env": bool(env_tok)}
    if db_tok and by:
        u = await db.get(AdminUser, by)
        info["updated_by"] = (u.name or u.email or u.username) if u else None
    if check and token and not info["expired"]:
        try:
            await _probe(db, kind, token)
            info["check"] = {"ok": True}
        except Exception as exc:  # noqa: BLE001 — hiển thị lý do cho admin
            info["check"] = {"ok": False, "error": str(exc)}
    return info


@router.get("/tokens", dependencies=[CONN_READ])
async def list_tokens(check: bool = False, db: AsyncSession = Depends(get_db)):
    row = await db.get(SmaxCredential, 1)
    return {"biz": settings.SMAX_BIZ_ALIAS,
            "tokens": [await _token_info(db, k, row, check=check) for k in TOKEN_KINDS]}


@router.post("/tokens/{kind}/check", dependencies=[CONN_READ])
async def check_token(kind: str, db: AsyncSession = Depends(get_db)):
    if kind not in TOKEN_KINDS:
        raise HTTPException(404, "Không có loại token này")
    return await _token_info(db, kind, await db.get(SmaxCredential, 1), check=True)


@router.put("/tokens/{kind}", dependencies=[CONN_MANAGE])
async def set_token(kind: str, body: TokenBody, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    if kind not in TOKEN_KINDS:
        raise HTTPException(404, "Không có loại token này")
    token = _clean(body.token)
    exp = smax_blocks.token_expiry(token)
    if kind == "user" and not exp:
        raise HTTPException(422, "Token không đúng dạng JWT đăng nhập của Smax")
    if exp and exp < datetime.now(timezone.utc):
        raise HTTPException(422, "Token đã hết hạn")
    try:  # thử với Smax trước khi lưu — sai thì không lưu
        await _probe(db, kind, token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Token không dùng được: {exc}") from exc
    row = await db.get(SmaxCredential, 1)
    if row is None:
        row = SmaxCredential(id=1)
        db.add(row)
    now = datetime.now(timezone.utc)
    if kind == "api":
        row.api_token, row.api_token_updated_by, row.api_token_updated_at = token, user.id, now
    else:
        row.user_token, row.updated_by, row.updated_at = token, user.id, now
    await db.commit()
    if kind == "api":
        smax.set_db_api_token(token)
    return await _token_info(db, kind, row)


@router.delete("/tokens/{kind}", dependencies=[CONN_MANAGE])
async def clear_token(kind: str, db: AsyncSession = Depends(get_db)):
    """Xoá token đã dán ở Cài đặt → quay về token trong .env (nếu có)."""
    if kind not in TOKEN_KINDS:
        raise HTTPException(404, "Không có loại token này")
    row = await db.get(SmaxCredential, 1)
    if row:
        if kind == "api":
            row.api_token = row.api_token_updated_by = row.api_token_updated_at = None
        else:
            row.user_token = row.updated_by = None
        await db.commit()
    if kind == "api":
        smax.set_db_api_token(None)
    return await _token_info(db, kind, row)


@router.get("/blocks", dependencies=[READ])
async def list_blocks(db: AsyncSession = Depends(get_db)):
    try:
        blocks = await smax_blocks.list_blocks()
    except (smax.SmaxError, smax.SmaxRejected) as exc:
        raise _err(exc) from exc
    folders = await smax_blocks.list_folders(db)
    names = {f["id"]: f["name"] for f in folders}
    used = {b.get("group_id") for b in blocks}
    return {"folders": [f for f in folders if f["id"] in used or not f.get("parent_id")],
            "blocks": sorted((_block_out(b, names) for b in blocks), key=lambda x: x["updated_at"] or "", reverse=True)}


@router.get("/blocks/{block_id}", dependencies=[READ])
async def get_block(block_id: str, db: AsyncSession = Depends(get_db)):
    try:
        b = await smax_blocks.get_block(block_id)
    except (smax.SmaxError, smax.SmaxRejected) as exc:
        raise _err(exc) from exc
    if not b or b.get("platform") != "zaloweb":
        raise HTTPException(404, "Không tìm thấy block Zalo User")
    names = {f["id"]: f["name"] for f in await smax_blocks.list_folders(db)}
    return _block_out(b, names)


class MessageIn(BaseModel):
    text: str = Field(default="", max_length=2000)
    images: list[str] = Field(default_factory=list, max_length=10)


class BlockIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    group_id: str | None = None
    messages: list[MessageIn] = Field(min_length=1, max_length=10)


def _check_messages(messages: list[MessageIn]) -> list[dict]:
    out = []
    for m in messages:
        if not m.text.strip() and not m.images:
            raise HTTPException(422, "Mỗi tin cần có chữ hoặc ảnh")
        if any(not u.startswith("https://") for u in m.images):
            raise HTTPException(422, "Ảnh phải là link https")
        out.append({"text": m.text, "images": m.images})
    return out


@router.post("/blocks", status_code=201, dependencies=[WRITE])
async def create_block(body: BlockIn, db: AsyncSession = Depends(get_db)):
    try:
        b = await smax_blocks.create_block(db, body.name.strip(), body.group_id, _check_messages(body.messages))
    except (smax.SmaxError, smax.SmaxRejected) as exc:
        raise _err(exc) from exc
    return _block_out(b)


@router.put("/blocks/{block_id}", dependencies=[WRITE])
async def update_block(block_id: str, body: BlockIn, db: AsyncSession = Depends(get_db)):
    try:
        b = await smax_blocks.update_block(db, block_id, body.name.strip(), body.group_id or "", _check_messages(body.messages))
    except (smax.SmaxError, smax.SmaxRejected) as exc:
        raise _err(exc) from exc
    return _block_out(b)


@router.delete("/blocks/{block_id}", status_code=204, dependencies=[Depends(require_any_permission("zalo_templates.manage", "zalo_templates.edit"))])
async def delete_block(block_id: str, db: AsyncSession = Depends(get_db)):
    try:
        await smax_blocks.delete_block(db, block_id)
    except (smax.SmaxError, smax.SmaxRejected) as exc:
        raise _err(exc) from exc


@router.post("/images", dependencies=[WRITE])
async def upload_image(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    mime = file.content_type or ""
    if mime not in {"image/jpeg", "image/png", "image/gif", "image/webp"}:
        raise HTTPException(422, "Chỉ nhận ảnh JPG, PNG, GIF, WEBP")
    content = await file.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(422, "Ảnh tối đa 10MB")
    try:
        url = await smax_blocks.upload_image(db, file.filename or "image", content, mime)
    except (smax.SmaxError, smax.SmaxRejected) as exc:
        raise _err(exc) from exc
    return {"url": url}
