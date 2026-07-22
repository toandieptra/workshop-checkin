import uuid

import pytest
from fastapi import HTTPException

from app.models import AdminUser, GuestNote
from app.routers.guests import _can_edit_guest_note, _note_content


def _user(role: str) -> AdminUser:
    return AdminUser(id=uuid.uuid4(), email=f"{role}@example.com", role=role)


def test_admin_and_super_admin_can_edit_any_guest_note():
    author = _user("editor")
    note = GuestNote(author_user_id=author.id, guest_id=uuid.uuid4(), content="Note")

    assert _can_edit_guest_note(_user("admin"), note) is True
    assert _can_edit_guest_note(_user("super_admin"), note) is True


def test_non_admin_can_only_edit_own_guest_note():
    author = _user("editor")
    other_editor = _user("editor")
    note = GuestNote(author_user_id=author.id, guest_id=uuid.uuid4(), content="Note")

    assert _can_edit_guest_note(author, note) is True
    assert _can_edit_guest_note(other_editor, note) is False


def test_note_without_author_is_only_editable_by_admin():
    note = GuestNote(author_user_id=None, guest_id=uuid.uuid4(), content="Note")

    assert _can_edit_guest_note(_user("editor"), note) is False
    assert _can_edit_guest_note(_user("admin"), note) is True


def test_note_content_is_trimmed_and_cannot_be_empty():
    assert _note_content("  Nội dung  ") == "Nội dung"

    with pytest.raises(HTTPException) as exc:
        _note_content(" \n\t ")
    assert exc.value.status_code == 422
