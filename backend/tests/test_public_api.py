import uuid
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.auth.public_api import PUBLIC_API_SCOPES, ApiKeyPrincipal, generate_api_key, hash_api_key
from app.models import Guest, Workshop
from app.routers.admin_api_keys import _validate_scopes, purge_api_key
from app.routers.public_api import _guest_out, _meta, _workshop_out
from app.schemas_public import Envelope


def test_generated_api_key_has_expected_prefix_and_hash():
    raw, digest, prefix = generate_api_key()

    assert raw.startswith("wk_live_")
    assert digest == hash_api_key(raw)
    assert prefix == raw[:16]
    assert raw not in digest


def test_public_api_scopes_cover_full_v1_surface():
    assert PUBLIC_API_SCOPES == {
        "workshops.read",
        "guests.read",
        "guests.write",
        "checkin.read",
        "checkin.manage",
        "registration_forms.read",
        "registration_forms.write",
    }


def test_unknown_scope_is_rejected():
    with pytest.raises(HTTPException) as exc:
        _validate_scopes(["workshops.read", "admin.all"])

    assert exc.value.status_code == 400


def test_public_envelope_defaults_are_stable():
    payload = Envelope[dict](data={"ok": True}).model_dump()

    assert payload == {"data": {"ok": True}, "meta": None, "error": None}


def test_pagination_meta_handles_empty_collection():
    assert _meta(1, 20, 0).model_dump() == {
        "page": 1,
        "per_page": 20,
        "total": 0,
        "total_pages": 0,
    }


def test_public_guest_projection_excludes_internal_fields():
    now = datetime.now(timezone.utc)
    guest = Guest(
        id=uuid.uuid4(),
        workshop_id=uuid.uuid4(),
        full_name="Guest",
        phone="0909123456",
        note="internal note",
        creator_name="Admin",
        party_size=1,
        registration_status="confirmed",
        checkin_status="not_checked_in",
        registered_at=now,
    )

    payload = _guest_out(guest).model_dump()

    assert payload["phone"] == "0909123456"
    assert "note" not in payload
    assert "creator_name" not in payload
    assert "source" not in payload


def test_public_workshop_projection_excludes_form_management_fields():
    workshop = Workshop(
        id=uuid.uuid4(),
        name="Workshop",
        slug="workshop",
        status="published",
        auto_confirm_registration=True,
    )
    workshop.media = []

    payload = _workshop_out(workshop).model_dump()

    assert payload["slug"] == "workshop"
    assert "landing_registration_form_id" not in payload
    assert "registration_forms" not in payload


def test_active_api_key_cannot_be_permanently_deleted():
    record = AsyncMock()
    record.is_active = True
    db = AsyncMock()
    db.get.return_value = record

    with pytest.raises(HTTPException) as exc:
        asyncio.run(purge_api_key(uuid.uuid4(), db, None))

    assert exc.value.status_code == 409
    db.delete.assert_not_awaited()
    db.commit.assert_not_awaited()


def test_revoked_api_key_can_be_permanently_deleted():
    record = AsyncMock()
    record.is_active = False
    db = AsyncMock()
    db.get.return_value = record

    asyncio.run(purge_api_key(uuid.uuid4(), db, None))

    db.delete.assert_awaited_once_with(record)
    db.commit.assert_awaited_once()
