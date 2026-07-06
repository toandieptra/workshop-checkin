import uuid
from datetime import datetime, date

from sqlalchemy import String, Text, Boolean, ForeignKey, Date, DateTime, Float, Integer, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Workshop(Base):
    __tablename__ = "workshops"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    event_date: Mapped[date | None] = mapped_column(Date)
    location: Mapped[str | None] = mapped_column(Text)
    lark_workshop_name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Guest(Base):
    __tablename__ = "guests"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"))
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    company: Mapped[str | None] = mapped_column(Text)
    business_model: Mapped[str | None] = mapped_column(Text)
    role_title: Mapped[str | None] = mapped_column(Text)
    guest_type: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    party_size: Mapped[int] = mapped_column(Integer, default=1)
    actual_party_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checkin_status: Mapped[str] = mapped_column(Text, default="not_checked_in")
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lark_record_id: Mapped[str | None] = mapped_column(Text)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Sync fields
    local_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lark_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_status: Mapped[str] = mapped_column(Text, default="pending_push")  # synced | pending_push | pending_pull | conflict | error
    sync_error: Mapped[str | None] = mapped_column(Text)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CheckinLog(Base):
    __tablename__ = "checkin_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"))
    guest_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="SET NULL"))
    method: Mapped[str] = mapped_column(Text, default="admin")
    # Legacy fields kept for historical data (no longer written by new code)
    similarity: Mapped[float | None] = mapped_column(Float)
    snapshot_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text)
    staff_feedback: Mapped[str | None] = mapped_column(Text)
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # New fields
    checked_in_by: Mapped[str | None] = mapped_column(Text)  # 'admin'
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WelcomeEvent(Base):
    __tablename__ = "welcome_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"))
    guest_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="SET NULL"))
    display_name: Mapped[str | None] = mapped_column(Text)
    display_message: Mapped[str | None] = mapped_column(Text)
    event_type: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RegistrationForm(Base):
    __tablename__ = "registration_forms"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    token: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"))
    greeting: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RegistrationFormWorkshop(Base):
    __tablename__ = "registration_form_workshops"
    form_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("registration_forms.id", ondelete="CASCADE"), primary_key=True)
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RegistrationSubmission(Base):
    __tablename__ = "registration_submissions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    form_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("registration_forms.id", ondelete="CASCADE"))
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"))
    guest_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="SET NULL"))
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str] = mapped_column(Text, nullable=False)
    party_size: Mapped[int] = mapped_column(Integer, default=1)
    business_model: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SyncLog(Base):
    __tablename__ = "sync_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    direction: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    lark_record_id: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
