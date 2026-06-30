import uuid
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict


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
    consent_face_recognition: bool = True


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
    consent_face_recognition: bool | None = None


class FaceProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    image_url: str | None
    quality_score: float | None
    is_active: bool
    source: str = "reference"
    created_at: datetime


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
    consent_face_recognition: bool
    checkin_status: str
    checked_in_at: datetime | None
    lark_record_id: str | None = None
    registered_at: datetime | None = None
    created_at: datetime
    face_profiles: list[FaceProfileOut] = []


class RecognizeResult(BaseModel):
    decision: str  # auto | confirm | reject | no_face | duplicate
    similarity: float | None = None
    quality_score: float | None = None
    guest: GuestOut | None = None
    message: str
    log_id: uuid.UUID | None = None


class ConfirmRequest(BaseModel):
    workshop_id: uuid.UUID
    guest_id: uuid.UUID
    log_id: uuid.UUID | None = None
    feedback: str = "correct"  # correct | wrong
    similarity: float | None = None


class ManualCheckinRequest(BaseModel):
    workshop_id: uuid.UUID
    guest_id: uuid.UUID
    method: str = "manual"  # manual | qr


class ResendRequest(BaseModel):
    workshop_id: uuid.UUID
    guest_id: uuid.UUID


class ResetRequest(BaseModel):
    guest_id: uuid.UUID


class UploadImageItem(BaseModel):
    url: str
    name: str
    size: int
    mime: str


class UploadSessionCreate(BaseModel):
    max_files: int = 30
    subfolder: str | None = "qr-upload"
    ttl_seconds: int = 600


class UploadSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: str
    images: list[dict]
    max_files: int
    expires_at: datetime
    upload_url: str | None = None
    token: str | None = None  # chi tra ve luc tao


class UploadImagesResponse(BaseModel):
    items: list[UploadImageItem]
    errors: list[str]
