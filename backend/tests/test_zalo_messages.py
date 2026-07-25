import asyncio
import uuid
from datetime import date, time
from types import SimpleNamespace

import pytest

from app.config import settings
from app.models import Guest, Workshop
from app.services.zalo_messages import (
    AUTO_SEND_CHECKIN,
    AUTO_SEND_NEW_GUEST,
    calls_per_guest,
    create_delivery,
    enqueue_auto_send,
    render_block,
    template_variables,
    validate_blocks,
)


def test_template_blocks_support_text_album_and_video(monkeypatch):
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://workshop.example.com")
    blocks = validate_blocks([
        {"type": "text", "text": "Xin chao"},
        {"type": "image_album", "images": [{"url": "/uploads/a.jpg"}]},
        {"type": "video", "url": "/uploads/a.mp4", "thumbnail_url": "/uploads/a.jpg"},
    ])
    assert [item["type"] for item in blocks] == ["text", "image_album", "video"]


def test_template_blocks_reject_video_without_thumbnail():
    with pytest.raises(ValueError, match="thumbnail_url"):
        validate_blocks([{"type": "video", "url": "/uploads/a.mp4"}])


def test_template_blocks_enforce_image_count(monkeypatch):
    monkeypatch.setattr(settings, "ZALO_TEMPLATE_MAX_IMAGE_COUNT", 1)
    with pytest.raises(ValueError, match="ảnh"):
        validate_blocks([{"type": "image_album", "images": [{"url": "/uploads/a.jpg"}, {"url": "/uploads/b.jpg"}]}])


def test_template_blocks_reject_unknown_type():
    with pytest.raises(ValueError, match="block type"):
        validate_blocks([{"type": "file", "url": "/uploads/a.pdf"}])


def test_template_blocks_reject_blank_text():
    with pytest.raises(ValueError, match="text block"):
        validate_blocks([{"type": "text", "text": "  "}])


def test_consecutive_images_are_compiled_to_one_album_and_media_limit_includes_videos(monkeypatch):
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://workshop.example.com")
    blocks = validate_blocks([
        {"type": "text", "text": "A"},
        {"type": "image", "url": "/uploads/a.jpg"},
        {"type": "image", "url": "/uploads/b.jpg"},
        {"type": "video", "url": "/uploads/v.mp4", "thumbnail_url": "/uploads/t.jpg"},
        {"type": "text", "text": "B"},
    ])
    assert [block["type"] for block in blocks] == ["text", "image_album", "video", "text"]
    assert len(blocks[1]["images"]) == 2
    assert calls_per_guest(blocks) == 4


def test_media_limit_is_shared_by_images_and_videos(monkeypatch):
    monkeypatch.setattr(settings, "ZALO_TEMPLATE_MAX_MEDIA_COUNT", 2)
    with pytest.raises(ValueError, match="media"):
        validate_blocks([
            {"type": "image", "url": "/uploads/a.jpg"},
            {"type": "video", "url": "https://example.com/v.mp4", "thumbnail_url": "https://example.com/t.jpg"},
            {"type": "image", "url": "/uploads/b.jpg"},
        ])


def test_template_text_accepts_known_variables_and_renders_missing_as_empty():
    validate_blocks([{"type": "text", "text": "Chào {{full_name}} {{workshop_name}}"}])
    guest = Guest(full_name="Mai", email=None)
    values = template_variables(guest, None)
    assert render_block({"type": "text", "text": "{{full_name}}/{{email}}"}, values)["text"] == "Mai/"


@pytest.mark.parametrize("text", [
    "{{unknown}}",
    "{full_name}",
    "{{full_name}",
    "full_name}}",
    "{{ full_name }}",
])
def test_template_text_rejects_unknown_or_malformed_placeholders(text):
    with pytest.raises(ValueError):
        validate_blocks([{"type": "text", "text": text}])


def test_template_variables_include_workshop_values():
    guest = Guest(full_name="Mai", party_size=2, actual_party_size=None)
    workshop = Workshop(
        name="Workshop A", slug="workshop-a", event_date=date(2026, 7, 24),
        event_time=time(9, 30), location="Hanoi", branch="Hà Nội",
    )
    values = template_variables(guest, workshop)
    assert values["workshop_date"] == "24/07/2026"
    assert values["workshop_time"] == "09:30"
    assert values["workshop_branch"] == "Hà Nội"
    assert values["actual_party_size"] == ""


def test_batch_guests_get_distinct_rendered_text_snapshots():
    workshop = Workshop(name="Workshop A", slug="workshop-a")
    block = {"type": "text", "text": "Chào {{full_name}} từ {{company}}"}
    first = render_block(block, template_variables(Guest(full_name="Mai", company="A"), workshop))
    second = render_block(block, template_variables(Guest(full_name="Lan", company="B"), workshop))
    assert first["text"] == "Chào Mai từ A"
    assert second["text"] == "Chào Lan từ B"
    assert block["text"] == "Chào {{full_name}} từ {{company}}"


def test_rendered_text_snapshot_keeps_image_album_unchanged():
    block = {"type": "image_album", "images": [{"url": "/uploads/a.jpg"}]}
    assert render_block(block, {"full_name": "Mai"}) == block


def test_create_delivery_renders_each_guest_item_snapshot(monkeypatch):
    workshop_id = uuid.uuid4()
    workshop = Workshop(id=workshop_id, name="Workshop A", slug="workshop-a")
    guests = [
        Guest(id=uuid.uuid4(), workshop_id=workshop_id, full_name="Mai"),
        Guest(id=uuid.uuid4(), workshop_id=workshop_id, full_name="Lan"),
    ]
    template = SimpleNamespace(
        id=uuid.uuid4(), name="Greeting",
        content_blocks=[{"type": "text", "text": "Chào {{full_name}}"}],
    )

    class FakeDb:
        def __init__(self):
            self.added = []

        def add(self, value):
            self.added.append(value)
            if value.__class__.__name__ == "ZaloDelivery" and value.id is None:
                value.id = uuid.uuid4()

        async def flush(self):
            pass

        async def get(self, model, key):
            return workshop if model is Workshop and key == workshop_id else None

    async def resolve_recipient(db, guest, *, refresh=False):
        return SimpleNamespace(recipient_id=str(guest.id), recipient_name=guest.full_name)

    async def reserve_quota(db, amount, delivery_id):
        return None

    monkeypatch.setattr(settings, "ZALO_MESSAGES_ENABLED", True)
    monkeypatch.setattr("app.services.zalo_messages.resolve_recipient", resolve_recipient)
    monkeypatch.setattr("app.services.zalo_messages.reserve_quota", reserve_quota)
    db = FakeDb()

    delivery = asyncio.run(create_delivery(db, template, guests, idempotency_key=uuid.uuid4()))
    items = [value for value in db.added if value.__class__.__name__ == "ZaloDeliveryItem"]
    assert delivery.content_blocks[0]["text"] == "Chào {{full_name}}"
    assert [item.block_payload["text"] for item in items] == ["Chào Mai", "Chào Lan"]


def test_enqueue_auto_send_uses_active_templates_and_dedupes(monkeypatch):
    guest = Guest(id=uuid.uuid4(), full_name="Mai", phone="0901234567")
    active = SimpleNamespace(
        id=uuid.uuid4(), name="Active", status="active",
        auto_send_new_guest=True, auto_send_checkin=False,
        content_blocks=[{"type": "text", "text": "Xin chào"}],
    )
    inactive = SimpleNamespace(
        id=uuid.uuid4(), name="Inactive", status="draft",
        auto_send_new_guest=True, auto_send_checkin=False,
        content_blocks=[{"type": "text", "text": "Không gửi"}],
    )
    created = []

    class FakeResult:
        def scalars(self):
            return self

        def __iter__(self):
            return iter([active])

    class FakeDb:
        async def scalar(self, stmt):
            return None

        async def execute(self, stmt):
            return FakeResult()

    async def fake_create_delivery(db, template, guests, created_by=None, batch_id=None, refresh=False, idempotency_key=None):
        created.append((template.id, str(idempotency_key), [guest.id for guest in guests]))
        return SimpleNamespace(id=uuid.uuid4(), template_id=template.id, idempotency_key=str(idempotency_key))

    monkeypatch.setattr(settings, "ZALO_MESSAGES_ENABLED", True)
    monkeypatch.setattr("app.services.zalo_messages.create_delivery", fake_create_delivery)

    first = asyncio.run(enqueue_auto_send(FakeDb(), guest, AUTO_SEND_NEW_GUEST))
    assert len(first) == 1
    assert created == [(active.id, f"{AUTO_SEND_NEW_GUEST}:{active.id}:{guest.id}", [guest.id])]
    assert inactive.id not in {item[0] for item in created}

    class DedupDb(FakeDb):
        async def scalar(self, stmt):
            return uuid.uuid4()

    second = asyncio.run(enqueue_auto_send(DedupDb(), guest, AUTO_SEND_NEW_GUEST))
    assert second == []
    assert len(created) == 1


def test_enqueue_auto_send_checkin_selects_flag(monkeypatch):
    guest = Guest(id=uuid.uuid4(), full_name="Mai", phone="0901234567")
    template = SimpleNamespace(
        id=uuid.uuid4(), name="Checkin", status="active",
        auto_send_new_guest=False, auto_send_checkin=True,
        content_blocks=[{"type": "text", "text": "Check-in ok"}],
    )
    created = []

    class FakeResult:
        def scalars(self):
            return self

        def __iter__(self):
            return iter([template])

    class FakeDb:
        async def scalar(self, stmt):
            return None

        async def execute(self, stmt):
            return FakeResult()

    async def fake_create_delivery(db, template, guests, created_by=None, batch_id=None, refresh=False, idempotency_key=None):
        created.append(str(idempotency_key))
        return SimpleNamespace(id=uuid.uuid4())

    monkeypatch.setattr(settings, "ZALO_MESSAGES_ENABLED", True)
    monkeypatch.setattr("app.services.zalo_messages.create_delivery", fake_create_delivery)
    deliveries = asyncio.run(enqueue_auto_send(FakeDb(), guest, AUTO_SEND_CHECKIN))
    assert len(deliveries) == 1
    assert created == [f"{AUTO_SEND_CHECKIN}:{template.id}:{guest.id}"]
