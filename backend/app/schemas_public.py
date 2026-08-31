import uuid
from datetime import date, datetime, time
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

from .schemas import RegistrationFormPublic, WorkshopMediaOut


T = TypeVar("T")


class ApiErrorDetail(BaseModel):
    code: str
    message: str
    details: dict | list | None = None


class PaginationMeta(BaseModel):
    page: int
    per_page: int
    total: int
    total_pages: int


class Envelope(BaseModel, Generic[T]):
    data: T | None = None
    meta: PaginationMeta | None = None
    error: ApiErrorDetail | None = None


class PublicWorkshop(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    event_date: date | None = None
    event_time: time | None = None
    location: str | None = None
    status: str
    branch: str | None = None
    maps_url: str | None = None
    registration_short_url: str | None = None
    zalo_group_url: str | None = None
    auto_confirm_registration: bool
    media: list[WorkshopMediaOut] = Field(default_factory=list)


class PublicGuest(BaseModel):
    id: uuid.UUID
    workshop_id: uuid.UUID
    full_name: str
    phone: str | None = None
    email: str | None = None
    company: str | None = None
    business_model: str | None = None
    role_title: str | None = None
    guest_type: str | None = None
    party_size: int
    registration_status: str
    actual_party_size: int | None = None
    checkin_status: str
    checked_in_at: datetime | None = None
    registered_at: datetime | None = None


class PublicGuestLookup(BaseModel):
    found: bool
    reason: str
    workshop_name: str
    guest: PublicGuest | None = None


class PublicCheckinRequest(BaseModel):
    guest_id: uuid.UUID
    workshop_slug: str
    phone: str
    actual_party_size: int | None = Field(default=None, ge=1, le=100)


class PublicCheckinResult(BaseModel):
    guest: PublicGuest


class PublicSelfRegisterRequest(BaseModel):
    workshop_slug: str
    full_name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=9, max_length=20)
    actual_party_size: int = Field(default=1, ge=1, le=100)
    business_model: str | None = Field(default=None, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=320)


class PublicSelfRegisterResult(BaseModel):
    guest: PublicGuest
    warning: str | None = None


class PublicRegistrationResult(BaseModel):
    guest: PublicGuest
    submission_id: uuid.UUID
    registration_status: str


class PublicHealth(BaseModel):
    status: str
    db: bool


RegistrationFormEnvelope = Envelope[RegistrationFormPublic]
