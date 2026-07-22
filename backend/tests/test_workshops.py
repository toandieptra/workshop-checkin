import asyncio
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.models import Workshop
from app.routers.workshops import _to_out, _validate_status_transition


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
