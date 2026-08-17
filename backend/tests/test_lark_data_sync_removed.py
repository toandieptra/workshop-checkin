import inspect
import os
from pathlib import Path

os.environ.setdefault("UPLOAD_DIR", str(Path(__file__).parent / ".test-uploads"))

from app.auth.permissions import PERMISSIONS
from app.config import settings

settings.UPLOAD_DIR = os.environ["UPLOAD_DIR"]

from app.main import app
from app.routers import guests, registration_forms, workshops
from app.schemas import GuestOut, RegistrationSubmitResult, WorkshopOut
from app.services import lark_client


def test_lark_data_sync_routes_are_not_registered():
    paths = {route.path for route in app.routes}

    assert not any(path.startswith("/api/lark/sync") for path in paths)
    assert "/api/admin/users/directory-sync" in paths
    assert "/api/admin/users/directory-sync/status" in paths


def test_lark_data_sync_permissions_are_removed():
    assert "lark.read" not in PERMISSIONS
    assert "lark.sync" not in PERMISSIONS


def test_workshop_and_guest_schemas_do_not_expose_lark_data():
    workshop_fields = WorkshopOut.model_fields
    guest_fields = GuestOut.model_fields

    assert "lark_workshop_name" not in workshop_fields
    assert "lark_record_id" not in workshop_fields
    assert "last_synced_at" not in workshop_fields
    assert "lark_record_id" not in guest_fields
    assert "last_synced_at" not in guest_fields
    assert "sync_status" not in guest_fields
    assert "sync_error" not in guest_fields
    assert "lark_synced" not in RegistrationSubmitResult.model_fields


def test_guest_and_workshop_mutations_do_not_reference_lark_sync():
    source = "\n".join((
        inspect.getsource(guests),
        inspect.getsource(workshops),
        inspect.getsource(registration_forms),
    ))

    assert "lark_sync" not in source
    assert "sync_lark" not in source
    assert "lark_client" not in source


def test_lark_client_only_exposes_auth_and_directory_operations():
    for removed in ("list_records", "create_record", "update_record", "upload_bitable_media"):
        assert not hasattr(lark_client, removed)
    assert hasattr(lark_client, "list_contact_users")
    assert hasattr(lark_client, "get_tenant_token")
