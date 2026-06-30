import uuid
from datetime import datetime, date

from sqlalchemy import String, Text, Boolean, ForeignKey, Date, DateTime, Float, Integer, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

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
    consent_face_recognition: Mapped[bool] = mapped_column(Boolean, default=True)
    checkin_status: Mapped[str] = mapped_column(Text, default="not_checked_in")
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lark_record_id: Mapped[str | None] = mapped_column(Text)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    face_profiles: Mapped[list["FaceProfile"]] = relationship(back_populates="guest", cascade="all, delete-orphan")


class FaceProfile(Base):
    __tablename__ = "face_profiles"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    guest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="CASCADE"))
    image_url: Mapped[str | None] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(512))
    quality_score: Mapped[float | None] = mapped_column(Float)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(Text, nullable=False, default="reference")  # reference | checkin
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    guest: Mapped["Guest"] = relationship(back_populates="face_profiles")


class CheckinLog(Base):
    __tablename__ = "checkin_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"))
    guest_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="SET NULL"))
    method: Mapped[str | None] = mapped_column(Text)
    similarity: Mapped[float | None] = mapped_column(Float)
    snapshot_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text)
    staff_feedback: Mapped[str | None] = mapped_column(Text)
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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


class UploadSession(Base):
    __tablename__ = "upload_sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    token: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="open", nullable=False)
    images: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    max_files: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    subfolder: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
