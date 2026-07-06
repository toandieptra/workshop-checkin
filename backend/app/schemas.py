import uuid
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict


# ===== Workshop =====

class WorkshopCreate(BaseModel):
    name: str
    slug: str
    event_date: date | None = None
    location: str | None = None
    lark_workshop_name: str | None = None


class WorkshopOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    slug: str
    event_date: date | None
    location: str | None
    lark_workshop_name: str | None = None
    created_at: datetime
    last_synced_at: datetime | None = None


# ===== Guest =====

class GuestCreate(BaseModel):
    full_name: str
    phone: str | None = None
    email: str | None = None
    company: str | None = None
    business_model: str | None = None
    role_title: str | None = None
    guest_type: str | None = None
    note: str | None = None
    party_size: int = 1


class GuestUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    email: str | None = None
    company: str | None = None
    business_model: str | None = None
    role_title: str | None = None
    guest_type: str | None = None
    note: str | None = None
    party_size: int | None = None


class GuestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workshop_id: uuid.UUID
    full_name: str
    phone: str | None
    email: str | None
    company: str | None
    business_model: str | None = None
    role_title: str | None
    guest_type: str | None
    note: str | None
    party_size: int
    actual_party_size: int | None = None
    checkin_status: str
    checked_in_at: datetime | None
    lark_record_id: str | None = None
    registered_at: datetime | None = None
    created_at: datetime
    # Sync fields
    local_updated_at: datetime | None = None
    lark_updated_at: datetime | None = None
    last_synced_at: datetime | None = None
    sync_status: str | None = None
    sync_error: str | None = None


class GuestUpdateResult(BaseModel):
    guest: GuestOut
    lark_synced: bool = False
    lark_error: str | None = None


# ===== Check-in =====

class CheckinResult(BaseModel):
    guest: GuestOut
    lark_synced: bool = False
    lark_error: str | None = None


class CheckinLogOut(BaseModel):
    id: uuid.UUID
    guest_id: uuid.UUID | None
    method: str
    status: str | None
    checked_in_at: datetime | None
    checked_in_by: str | None = None
    note: str | None = None
    created_at: datetime


# ===== Self check-in (khách quét QR) =====

class CheckinSelfRequest(BaseModel):
    """Body cho endpoint check-in (admin flow + self QR flow)."""
    actual_party_size: int | None = None


class LookupByPhoneResult(BaseModel):
    found: bool
    reason: str | None = None  # not_in_workshop | wrong_workshop | ok
    guest: GuestOut | None = None
    workshop_name: str | None = None
    other_workshop_name: str | None = None
    other_workshop_slug: str | None = None
    registered_party_size: int | None = None  # số vé đăng ký


class SelfRegisterRequest(BaseModel):
    workshop_slug: str
    full_name: str
    phone: str
    actual_party_size: int = 1
    business_model: str | None = None
    company: str | None = None
    email: str | None = None


class SelfRegisterResult(BaseModel):
    guest: GuestOut
    lark_synced: bool = False
    warning: str | None = None


# ===== Lark Sync =====

class LarkWorkshop(BaseModel):
    lark_workshop_name: str
    event_date: str | None = None
    location: str | None = None


class SyncPullRequest(BaseModel):
    lark_workshop_name: str
    target_workshop_id: uuid.UUID | None = None


class SyncPullResult(BaseModel):
    workshop_id: uuid.UUID
    workshop_name: str
    pulled: int
    conflicts: int
    errors: int


class SyncPushRequest(BaseModel):
    guest_id: uuid.UUID | None = None  # None = push all unsynced


class SyncPushResult(BaseModel):
    workshop_id: uuid.UUID
    total: int
    pushed: int
    errors: int
    error_details: list[str] = []


class SyncFullRequest(BaseModel):
    lark_workshop_name: str
    target_workshop_id: uuid.UUID | None = None


class SyncStatus(BaseModel):
    pending_push: int
    pending_pull: int
    conflicts: int
    errors: int
    last_sync_at: datetime | None = None


class SyncResolveRequest(BaseModel):
    direction: str  # 'local' | 'lark'


class SyncResolveResult(BaseModel):
    guest: GuestOut
    resolved: bool
    lark_error: str | None = None


class SyncLogOut(BaseModel):
    id: uuid.UUID
    direction: str
    entity_type: str
    entity_id: uuid.UUID | None
    lark_record_id: str | None
    status: str
    error_message: str | None
    created_at: datetime


# ===== Registration Forms =====

class RegistrationWorkshopOption(BaseModel):
    id: uuid.UUID
    name: str
    event_date: date | None = None
    location: str | None = None


class RegistrationFormCreate(BaseModel):
    workshop_ids: list[uuid.UUID] | None = None
    workshop_id: uuid.UUID | None = None  # backward-compatible: form cũ chỉ 1 workshop
    greeting: str | None = None


class RegistrationFormUpdate(BaseModel):
    greeting: str | None = None
    is_active: bool | None = None
    workshop_ids: list[uuid.UUID] | None = None


class RegistrationFormOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    token: str
    workshop_id: uuid.UUID
    workshop_name: str | None = None
    workshops: list[RegistrationWorkshopOption] = []
    greeting: str | None = None
    is_active: bool
    submission_count: int = 0
    created_at: datetime
    updated_at: datetime


class RegistrationFormPublic(BaseModel):
    """Dữ liệu form công khai cho trang /register/:token."""
    token: str
    greeting: str | None = None
    is_active: bool
    workshop_id: uuid.UUID
    workshop_name: str
    workshop_event_date: date | None = None
    workshop_location: str | None = None
    workshops: list[RegistrationWorkshopOption] = []


class RegistrationSubmitRequest(BaseModel):
    workshop_id: uuid.UUID
    full_name: str
    phone: str
    party_size: int
    business_model: str | None = None


class RegistrationSubmitResult(BaseModel):
    guest: GuestOut
    submission_id: uuid.UUID
    lark_synced: bool = False
