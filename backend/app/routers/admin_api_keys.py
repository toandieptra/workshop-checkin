import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import require_permission
from ..auth.public_api import PUBLIC_API_SCOPES, generate_api_key
from ..config import settings
from ..db import get_db
from ..models import AdminUser, ApiKey


router = APIRouter(prefix="/api/admin/api-keys", tags=["admin-api-keys"])


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scopes: list[str] = Field(min_length=1)
    expires_at: datetime | None = None


class ApiKeyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    scopes: list[str] | None = Field(default=None, min_length=1)
    is_active: bool | None = None
    expires_at: datetime | None = None


def _validate_scopes(scopes: list[str]) -> list[str]:
    normalized = sorted(set(scopes))
    unknown = set(normalized) - PUBLIC_API_SCOPES
    if unknown:
        raise HTTPException(400, f"unknown public API scopes: {', '.join(sorted(unknown))}")
    return normalized


def _out(record: ApiKey, raw_key: str | None = None) -> dict:
    return {
        "id": record.id,
        "name": record.name,
        "key_prefix": record.key_prefix,
        "scopes": sorted(record.scopes),
        "rate_limit": record.rate_limit,
        "is_active": record.is_active,
        "expires_at": record.expires_at,
        "last_used_at": record.last_used_at,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "key": raw_key,
    }


@router.get("")
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    records = (await db.execute(select(ApiKey).order_by(ApiKey.created_at.desc()))).scalars().all()
    return {"keys": [_out(record) for record in records], "available_scopes": sorted(PUBLIC_API_SCOPES)}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_api_key(
    body: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    user: AdminUser = Depends(require_permission("users.manage")),
):
    raw, key_hash, key_prefix = generate_api_key()
    record = ApiKey(
        name=body.name.strip(),
        key_hash=key_hash,
        key_prefix=key_prefix,
        scopes=_validate_scopes(body.scopes),
        rate_limit=settings.PUBLIC_API_RATE_LIMIT_PER_MINUTE,
        expires_at=body.expires_at,
        created_by=user.id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return _out(record, raw)


async def _get_key(db: AsyncSession, key_id: uuid.UUID) -> ApiKey:
    record = await db.get(ApiKey, key_id)
    if not record:
        raise HTTPException(404, "API key not found")
    return record


@router.patch("/{key_id}")
async def update_api_key(
    key_id: uuid.UUID,
    body: ApiKeyUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    record = await _get_key(db, key_id)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    if "scopes" in changes:
        changes["scopes"] = _validate_scopes(changes["scopes"])
    for field, value in changes.items():
        setattr(record, field, value)
    record.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(record)
    return _out(record)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    record = await _get_key(db, key_id)
    record.is_active = False
    record.updated_at = datetime.now(timezone.utc)
    await db.commit()


@router.delete("/{key_id}/purge", status_code=status.HTTP_204_NO_CONTENT)
async def purge_api_key(
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    record = await _get_key(db, key_id)
    if record.is_active:
        raise HTTPException(409, "revoke API key before deleting it permanently")
    await db.delete(record)
    await db.commit()


@router.post("/{key_id}/rotate")
async def rotate_api_key(
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AdminUser = Depends(require_permission("users.manage")),
):
    previous = await _get_key(db, key_id)
    previous.is_active = False
    previous.updated_at = datetime.now(timezone.utc)
    raw, key_hash, key_prefix = generate_api_key()
    replacement = ApiKey(
        name=previous.name,
        key_hash=key_hash,
        key_prefix=key_prefix,
        scopes=list(previous.scopes),
        rate_limit=previous.rate_limit,
        expires_at=previous.expires_at,
        created_by=user.id,
    )
    db.add(replacement)
    await db.commit()
    await db.refresh(replacement)
    return _out(replacement, raw)
