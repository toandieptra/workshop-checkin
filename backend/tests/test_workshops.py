import asyncio
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.models import RegistrationForm, Workshop
from app.routers.workshops import (
    _linked_form,
    _to_out,
    _validate_status_transition,
    get_workshop_landing_page,
    update_workshop_landing_page,
)
from app.routers.registration_forms import _replace_form_workshops
from app.schemas import WorkshopLandingPageUpdate, WorkshopLinkedFormOut


@pytest.mark.parametrize(
    ("current", "target"),
    [
        ("draft", "draft"),
        ("draft", "published"),
        ("published", "completed"),
        ("cancelled", "draft"),
    ],
)
def test_valid_workshop_status_transitions(current, target):
    _validate_status_transition(current, target)


@pytest.mark.parametrize(
    ("current", "target"),
    [
        ("draft", "completed"),
        ("published", "draft"),
        ("completed", "draft"),
        ("completed", "published"),
    ],
)
def test_invalid_workshop_status_transitions(current, target):
    with pytest.raises(HTTPException) as exc:
        _validate_status_transition(current, target)
    assert exc.value.status_code == 409


def test_cancelling_requires_delete_path():
    with pytest.raises(HTTPException) as exc:
        _validate_status_transition("draft", "cancelled")
    assert exc.value.status_code == 403

    _validate_status_transition("draft", "cancelled", allow_cancel=True)


def test_workshop_output_preserves_auto_confirm_setting():
    now = datetime.now(timezone.utc)
    workshop = Workshop(
        id=uuid.uuid4(),
        name="Workshop",
        slug="workshop",
        status="draft",
        auto_confirm_registration=False,
        created_at=now,
        updated_at=now,
    )
    workshop.media = []

    with patch("app.routers.workshops._linked_forms", AsyncMock(return_value=[])):
        output = asyncio.run(_to_out(AsyncMock(), workshop))

    assert output.auto_confirm_registration is False


def test_linked_form_uses_m2m_membership_when_links_exist():
    workshop_id = uuid.uuid4()
    form = RegistrationForm(id=uuid.uuid4(), workshop_id=workshop_id, token="token", is_active=True)
    db = AsyncMock()
    db.get.return_value = form
    result = MagicMock()
    result.scalars.return_value.all.return_value = [uuid.uuid4()]
    db.execute.return_value = result

    linked = asyncio.run(_linked_form(db, workshop_id, form.id))

    assert linked is None


def test_linked_form_falls_back_to_legacy_workshop_id():
    workshop_id = uuid.uuid4()
    form = RegistrationForm(id=uuid.uuid4(), workshop_id=workshop_id, token="token", is_active=True)
    db = AsyncMock()
    db.get.return_value = form
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    db.execute.return_value = result

    linked = asyncio.run(_linked_form(db, workshop_id, form.id))

    assert linked is form


def test_update_landing_page_rejects_form_from_another_workshop():
    workshop = Workshop(id=uuid.uuid4(), name="Workshop", slug="workshop", status="published")
    db = AsyncMock()
    body = WorkshopLandingPageUpdate(registration_form_id=uuid.uuid4())

    with (
        patch("app.routers.workshops._get_workshop", AsyncMock(return_value=workshop)),
        patch("app.routers.workshops._linked_form", AsyncMock(return_value=None)),
        pytest.raises(HTTPException) as exc,
    ):
        asyncio.run(update_workshop_landing_page(workshop.id, body, db))

    assert exc.value.status_code == 400
    db.commit.assert_not_awaited()


def test_update_landing_page_persists_selected_form():
    workshop = Workshop(id=uuid.uuid4(), name="Workshop", slug="workshop", status="published")
    workshop.media = []
    form = RegistrationForm(id=uuid.uuid4(), workshop_id=workshop.id, token="token", is_active=True)
    db = AsyncMock()
    body = WorkshopLandingPageUpdate(registration_form_id=form.id)

    with (
        patch("app.routers.workshops._get_workshop", AsyncMock(return_value=workshop)),
        patch("app.routers.workshops._linked_form", AsyncMock(return_value=form)),
        patch("app.routers.workshops._to_out", AsyncMock(return_value="output")),
    ):
        output = asyncio.run(update_workshop_landing_page(workshop.id, body, db))

    assert output == "output"
    assert workshop.landing_registration_form_id == form.id
    db.commit.assert_awaited_once()


def test_public_landing_page_returns_selected_form():
    now = datetime.now(timezone.utc)
    workshop = Workshop(
        id=uuid.uuid4(),
        name="Workshop",
        slug="workshop",
        status="published",
        landing_registration_form_id=uuid.uuid4(),
        created_at=now,
    )
    workshop.media = []
    form = RegistrationForm(
        id=workshop.landing_registration_form_id,
        workshop_id=workshop.id,
        token="token",
        is_active=True,
        created_at=now,
    )
    form_out = WorkshopLinkedFormOut(
        id=form.id,
        token=form.token,
        is_active=True,
        submission_count=0,
        created_at=now,
    )
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = workshop
    db.execute.return_value = result

    with (
        patch("app.routers.workshops._linked_form", AsyncMock(return_value=form)),
        patch("app.routers.workshops._linked_form_out", AsyncMock(return_value=form_out)),
    ):
        output = asyncio.run(get_workshop_landing_page("workshop", db))

    assert output.slug == "workshop"
    assert output.registration_form.id == form.id


def test_public_landing_page_requires_persisted_selection():
    workshop = Workshop(id=uuid.uuid4(), name="Workshop", slug="workshop", status="published")
    workshop.media = []
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = workshop
    db.execute.return_value = result

    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_workshop_landing_page("workshop", db))

    assert exc.value.status_code == 404


def test_replacing_form_workshops_clears_stale_landing_selection():
    form = RegistrationForm(id=uuid.uuid4(), workshop_id=uuid.uuid4(), token="token", is_active=True)
    kept_workshop_id = uuid.uuid4()
    stale_workshop = Workshop(
        id=uuid.uuid4(),
        name="Stale",
        slug="stale",
        status="published",
        landing_registration_form_id=form.id,
    )
    db = AsyncMock()
    db.add = MagicMock()
    stale_result = MagicMock()
    stale_result.scalars.return_value.all.return_value = [stale_workshop]
    db.execute.side_effect = [stale_result, MagicMock()]

    asyncio.run(_replace_form_workshops(db, form, [kept_workshop_id]))

    assert stale_workshop.landing_registration_form_id is None
    assert db.add.call_count == 1
