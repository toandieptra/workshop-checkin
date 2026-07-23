import asyncio
import inspect
import uuid
from unittest.mock import AsyncMock, patch

from app.models import Guest, Workshop
from app.routers import guests, lark_sync
from app.services import lark_client


class FakeDb:
    def __init__(self, workshop=None):
        self.workshop = workshop
        self.commits = 0

    async def get(self, model, _entity_id):
        if model is Workshop:
            return self.workshop
        return None

    async def commit(self):
        self.commits += 1

    def add(self, _entity):
        pass

    async def execute(self, _statement):
        class Result:
            @staticmethod
            def scalars():
                class Scalars:
                    @staticmethod
                    def all():
                        return []

                return Scalars()

        return Result()


def test_lark_router_exposes_only_outbound_sync_routes():
    paths = {route.path for route in lark_sync.router.routes}

    assert "/api/lark/sync/push/{workshop_id}" in paths
    assert "/api/lark/sync/push-guest/{guest_id}" in paths
    assert "/api/lark/sync/push-workshop/{workshop_id}" in paths
    assert "/api/lark/sync/pull" not in paths
    assert "/api/lark/sync/full" not in paths
    assert "/api/lark/sync/workshops" not in paths
    assert "/api/lark/sync/resolve/{guest_id}" not in paths
    assert "/api/lark/workshops" not in paths


def test_lark_client_targets_tables_without_view_filters():
    for function in (
        lark_client.list_records,
        lark_client.create_record,
        lark_client.update_record,
    ):
        parameters = inspect.signature(function).parameters
        assert "table_id" in parameters
        assert "view_id" not in parameters
        assert "filter" not in parameters


def test_push_guest_creates_lark_record_from_local_data():
    workshop = Workshop(id=uuid.uuid4(), name="Workshop Local", slug="workshop-local")
    guest = Guest(
        id=uuid.uuid4(),
        workshop_id=workshop.id,
        full_name="Nguyen Van A",
        phone="0909123456",
        business_model="Quan ca phe",
        source="Khác",
        source_detail="Website",
        creator_name="Admin",
        party_size=2,
    )
    db = FakeDb(workshop)

    with (
        patch.object(lark_sync.settings, "LARK_TABLE_REGISTRATIONS", "registrations"),
        patch.object(lark_sync.lark_client, "create_record", AsyncMock(return_value="rec-123")) as create,
    ):
        record_id = asyncio.run(lark_sync._push_guest_to_lark(db, guest))

    assert record_id == "rec-123"
    assert guest.lark_record_id == "rec-123"
    assert guest.sync_status == "synced"
    assert guest.sync_error is None
    create.assert_awaited_once_with("registrations", {
        "Họ và tên": "Nguyen Van A",
        "Số điện thoại": "0909123456",
        "Mô hình kinh doanh": "Quan ca phe",
        "Số vé đăng ký": 2,
        "Workshop (sale)": "Workshop Local",
        "Nguồn": "Khác: Website",
        "Người tạo Web": "Admin",
    })


def test_push_existing_guest_updates_lark_without_reading_it():
    guest = Guest(
        id=uuid.uuid4(),
        workshop_id=uuid.uuid4(),
        full_name="Tran Thi B",
        phone="0911222333",
        party_size=1,
        lark_record_id="rec-existing",
        sync_status="error",
        sync_error="old error",
    )
    db = FakeDb()

    with (
        patch.object(lark_sync.settings, "LARK_TABLE_REGISTRATIONS", "registrations"),
        patch.object(lark_sync.lark_client, "update_record", AsyncMock()) as update,
        patch.object(lark_sync.lark_client, "list_records", AsyncMock()) as list_records,
    ):
        record_id = asyncio.run(lark_sync._update_guest_on_lark(db, guest))

    assert record_id == "rec-existing"
    assert guest.sync_status == "synced"
    assert guest.sync_error is None
    assert guest.last_synced_at is not None
    update.assert_awaited_once()
    list_records.assert_not_awaited()


def test_checkin_writeback_uses_existing_lark_field_name():
    guest = Guest(id=uuid.uuid4(), workshop_id=uuid.uuid4(), full_name="Guest")
    guest.lark_record_id = "rec-checkin"

    with (
        patch.object(guests.settings, "LARK_WRITEBACK_ENABLED", True),
        patch.object(guests.settings, "LARK_TABLE_REGISTRATIONS", "registrations"),
        patch.object(guests.lark_client, "update_record", AsyncMock()) as update,
    ):
        error = asyncio.run(guests._lark_writeback_checkin(guest, True))

    assert error is None
    update.assert_awaited_once_with("registrations", "rec-checkin", {"Check-in": True})


def test_push_workshop_does_not_write_formula_date_field():
    workshop = Workshop(
        id=uuid.uuid4(),
        name="Workshop Local",
        slug="workshop-local",
        lark_record_id="rec-workshop",
    )
    db = FakeDb(workshop)

    with (
        patch.object(lark_sync.settings, "LARK_WRITEBACK_ENABLED", True),
        patch.object(lark_sync.settings, "LARK_TABLE_WORKSHOPS", "workshops"),
        patch.object(lark_sync.lark_client, "update_record", AsyncMock()) as update,
    ):
        asyncio.run(lark_sync._push_workshop_to_lark(db, workshop))

    fields = update.await_args.args[2]
    assert "Ngày" not in fields
