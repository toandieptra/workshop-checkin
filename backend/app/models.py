import uuid
from datetime import datetime, date, time

from sqlalchemy import String, Text, Boolean, CheckConstraint, Index, ForeignKey, Date, DateTime, Time, Float, Integer, BigInteger, Identity, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Workshop(Base):
    __tablename__ = "workshops"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    event_date: Mapped[date | None] = mapped_column(Date)
    event_time: Mapped[time | None] = mapped_column(Time)
    location: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="draft", nullable=False)
    auto_confirm_registration: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    branch: Mapped[str | None] = mapped_column(Text)
    maps_url: Mapped[str | None] = mapped_column(Text)
    registration_short_url: Mapped[str | None] = mapped_column(Text)
    zalo_group_url: Mapped[str | None] = mapped_column(Text)
    landing_registration_form_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("registration_forms.id", ondelete="SET NULL")
    )
    lark_workshop_name: Mapped[str | None] = mapped_column(Text)
    lark_record_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    media: Mapped[list["WorkshopMedia"]] = relationship(
        "WorkshopMedia",
        back_populates="workshop",
        cascade="all, delete-orphan",
        order_by="WorkshopMedia.sort_order",
    )


class AdminUser(Base):
    __tablename__ = "admin_users"
    __table_args__ = (
        CheckConstraint("(account_type = 'checkin_guest' AND username IS NOT NULL) OR (account_type <> 'checkin_guest' AND username IS NULL AND email IS NOT NULL)", name="admin_users_login_identity_check"),
        CheckConstraint("username IS NULL OR (length(username) BETWEEN 3 AND 64 AND username = lower(username))", name="admin_users_username_check"),
        CheckConstraint("account_type IN ('lark', 'local', 'checkin_guest')", name="admin_users_account_type_check"),
        CheckConstraint("account_type = 'lark' OR password_hash IS NOT NULL", name="admin_users_password_required"),
        CheckConstraint("account_type <> 'checkin_guest' OR (role = 'user' AND permission_overrides = '{}' AND access_starts_at IS NOT NULL AND access_expires_at IS NOT NULL AND access_starts_at < access_expires_at)", name="admin_users_guest_access_check"),
        CheckConstraint("account_type = 'checkin_guest' OR (access_workshop_id IS NULL AND access_starts_at IS NULL AND access_expires_at IS NULL)", name="admin_users_non_guest_access_check"),
        CheckConstraint("account_type = 'checkin_guest' OR access_all_workshops = false", name="admin_users_all_workshops_guest_only"),
    )
    username: Mapped[str | None] = mapped_column(Text)
    account_type: Mapped[str] = mapped_column(Text, default="lark", server_default="lark", nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text)
    # Cột cũ (một workshop); phạm vi hiện tại nằm ở guest_workshop_access và access_all_workshops.
    access_workshop_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="SET NULL"), index=True)
    access_all_workshops: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    access_starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    access_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    enterprise_email: Mapped[str | None] = mapped_column(Text)
    lark_open_id: Mapped[str | None] = mapped_column(Text)
    lark_union_id: Mapped[str | None] = mapped_column(Text)
    lark_tenant_key: Mapped[str | None] = mapped_column(Text)
    lark_user_id: Mapped[str | None] = mapped_column(Text)
    lark_account_status: Mapped[str | None] = mapped_column(Text)
    lark_is_activated: Mapped[bool | None] = mapped_column(Boolean)
    lark_is_frozen: Mapped[bool | None] = mapped_column(Boolean)
    lark_is_resigned: Mapped[bool | None] = mapped_column(Boolean)
    lark_last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    role: Mapped[str] = mapped_column(Text, default="viewer", nullable=False)
    # Workshop role applied to every workshop, including ones created later.
    all_workshops_role: Mapped[str | None] = mapped_column(Text, ForeignKey("role_permissions.role", ondelete="SET NULL"))
    permission_overrides: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sessions: Mapped[list["AdminSession"]] = relationship("AdminSession", cascade="all, delete-orphan")


Index("uq_admin_users_username_ci", func.lower(AdminUser.username), unique=True)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    role: Mapped[str] = mapped_column(Text, primary_key=True)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    permissions: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class GuestWorkshopAccess(Base):
    """Workshop mà một tài khoản khách check-in được phép truy cập."""
    __tablename__ = "guest_workshop_access"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="CASCADE"), primary_key=True,
    )
    workshop_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"), primary_key=True, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkshopMember(Base):
    __tablename__ = "workshop_members"
    __table_args__ = (CheckConstraint("role <> 'super_admin'", name="workshop_members_no_super_admin"),)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="CASCADE"), primary_key=True,
    )
    workshop_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"), primary_key=True, index=True,
    )
    role: Mapped[str] = mapped_column(
        Text, ForeignKey("role_permissions.role", onupdate="CASCADE", ondelete="RESTRICT"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AdminSession(Base):
    __tablename__ = "admin_sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user_agent: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(Text)


class AdminOAuthState(Base):
    __tablename__ = "admin_oauth_states"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    state_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    return_to: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ApiKey(Base):
    __tablename__ = "api_keys"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    name: Mapped[str] = mapped_column(Text, nullable=False)
    key_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    key_prefix: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    rate_limit: Mapped[int] = mapped_column(Integer, default=120, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AdminDirectorySyncState(Base):
    __tablename__ = "admin_directory_sync_state"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(Text, default="never", nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    users_seen: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users_updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users_deactivated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users_skipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)


class WorkshopMedia(Base):
    __tablename__ = "workshop_media"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"), nullable=False)
    media_type: Mapped[str] = mapped_column(Text, default="banner", nullable=False)
    file_url: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str | None] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(Text)
    file_size: Mapped[int | None] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lark_file_token: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    workshop: Mapped["Workshop"] = relationship("Workshop", back_populates="media")


class WorkshopLandingPage(Base):
    __tablename__ = "workshop_landing_pages"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    workshop_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    draft_content: Mapped[dict | None] = mapped_column(JSONB)
    published_content: Mapped[dict | None] = mapped_column(JSONB)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
    source: Mapped[str | None] = mapped_column(Text)
    source_detail: Mapped[str | None] = mapped_column(Text)
    creator_name: Mapped[str | None] = mapped_column(Text)
    creator_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    party_size: Mapped[int] = mapped_column(Integer, default=1)
    registration_status: Mapped[str] = mapped_column(Text, default="confirmed", nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    actual_party_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checkin_status: Mapped[str] = mapped_column(Text, default="not_checked_in")
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lark_record_id: Mapped[str | None] = mapped_column(Text)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Sync fields
    local_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_status: Mapped[str] = mapped_column(Text, default="pending_push")  # synced | pending_push | error
    sync_error: Mapped[str | None] = mapped_column(Text)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GuestNote(Base):
    __tablename__ = "guest_notes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    guest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="CASCADE"), nullable=False)
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


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
    source: Mapped[str | None] = mapped_column(Text)
    source_detail: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GuestCreatorAlias(Base):
    __tablename__ = "guest_creator_aliases"
    alias_number: Mapped[int] = mapped_column(
        BigInteger, Identity(start=1001), primary_key=True
    )
    ip_address: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZbsDelivery(Base):
    __tablename__ = "zbs_deliveries"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    guest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="CASCADE"), nullable=False)
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    event_key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(Text)
    template_id: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="pending", nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    msg_id: Mapped[str | None] = mapped_column(Text)
    sent_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivery_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    provider_response: Mapped[dict | None] = mapped_column(JSONB)
    sending_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recipient_uid: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZaloContactUid(Base):
    """UID Zalo theo SĐT (chuẩn hoá 0xxxxxxxxx), nhận từ webhook ZNS user_received_message."""
    __tablename__ = "zalo_contact_uids"
    phone: Mapped[str] = mapped_column(Text, primary_key=True)
    zalo_uid: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, default="zns_webhook", nullable=False)
    last_msg_id: Mapped[str | None] = mapped_column(Text)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZbsWebhookEvent(Base):
    __tablename__ = "zbs_webhook_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_name: Mapped[str | None] = mapped_column(Text)
    msg_id: Mapped[str | None] = mapped_column(Text)
    tracking_id: Mapped[str | None] = mapped_column(Text)
    matched: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    signature_ok: Mapped[bool | None] = mapped_column(Boolean)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZbsTemplate(Base):
    __tablename__ = "zbs_templates"
    template_id: Mapped[str] = mapped_column(Text, primary_key=True)
    template_name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    quality: Mapped[str | None] = mapped_column(Text)
    tag: Mapped[str | None] = mapped_column(Text)
    template_type: Mapped[int | None] = mapped_column(Integer)
    detail: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    preview_url: Mapped[str | None] = mapped_column(Text)
    price_sdt: Mapped[str | None] = mapped_column(Text)
    price_uid: Mapped[str | None] = mapped_column(Text)
    zalo_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZbsOAuthCredential(Base):
    __tablename__ = "zbs_oauth_credentials"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    access_token: Mapped[str | None] = mapped_column(Text)
    access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refresh_token: Mapped[str | None] = mapped_column(Text)
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_refresh_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZbsTaskConfig(Base):
    __tablename__ = "zbs_task_configs"
    task_key: Mapped[str] = mapped_column(Text, primary_key=True)
    task_label: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    template_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZaloTemplate(Base):
    __tablename__ = "zalo_templates"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    content_blocks: Mapped[list[dict]] = mapped_column(JSONB, default=list, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="draft", nullable=False)
    auto_send_new_guest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    auto_send_checkin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GuestZaloMapping(Base):
    __tablename__ = "guest_zalo_mappings"
    guest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="CASCADE"), primary_key=True)
    account_owner_id: Mapped[str] = mapped_column(Text, nullable=False)
    recipient_id: Mapped[str] = mapped_column(Text, nullable=False)
    recipient_name: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text, default="bridge", nullable=False)
    resolution: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    resolved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    refreshed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZaloDeliveryBatch(Base):
    __tablename__ = "zalo_delivery_batches"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    name: Mapped[str | None] = mapped_column(Text)
    template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("zalo_templates.id", ondelete="SET NULL"))
    selection: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="queued", nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZaloDelivery(Base):
    __tablename__ = "zalo_deliveries"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("zalo_delivery_batches.id", ondelete="SET NULL"))
    template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("zalo_templates.id", ondelete="SET NULL"))
    template_name: Mapped[str] = mapped_column(Text, nullable=False)
    content_blocks: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="queued", nullable=False)
    recipient_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sent_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    items: Mapped[list["ZaloDeliveryItem"]] = relationship("ZaloDeliveryItem", cascade="all, delete-orphan", order_by="ZaloDeliveryItem.created_at", lazy="selectin")


class ZaloQuotaUsage(Base):
    __tablename__ = "zalo_quota_usage"
    account_owner_id: Mapped[str] = mapped_column(Text, primary_key=True)
    capability: Mapped[str] = mapped_column(Text, primary_key=True)
    usage_date: Mapped[date] = mapped_column(Date, primary_key=True)
    daily_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    used_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZaloQuotaReservation(Base):
    __tablename__ = "zalo_quota_reservations"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    account_owner_id: Mapped[str] = mapped_column(Text, nullable=False)
    capability: Mapped[str] = mapped_column(Text, nullable=False)
    usage_date: Mapped[date] = mapped_column(Date, nullable=False)
    delivery_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("zalo_deliveries.id", ondelete="CASCADE"), unique=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    consumed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    released_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="active", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZaloDeliveryItem(Base):
    __tablename__ = "zalo_delivery_items"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    delivery_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("zalo_deliveries.id", ondelete="CASCADE"), nullable=False)
    guest_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="SET NULL"))
    recipient_id: Mapped[str | None] = mapped_column(Text)
    recipient_name: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    block_position: Mapped[int] = mapped_column(Integer, nullable=False)
    block_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    quota_cost: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="pending", nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sending_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    message_ids: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    provider_response: Mapped[dict | None] = mapped_column(JSONB)
    last_error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# =================================================================
# PHASE 2 — Catalog, survey, gift redemption (migration 045)
# =================================================================

class CatalogCategory(Base):
    __tablename__ = "catalog_categories"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_categories.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CatalogProduct(Base):
    __tablename__ = "catalog_products"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    category_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_categories.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    search_key: Mapped[str] = mapped_column(Text, default="", nullable=False)
    short_description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="active", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CatalogRecipe(Base):
    __tablename__ = "catalog_recipes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    category_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_categories.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    search_key: Mapped[str] = mapped_column(Text, default="", nullable=False)
    short_description: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="active", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CatalogRecipeProduct(Base):
    __tablename__ = "catalog_recipe_products"
    recipe_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_recipes.id", ondelete="CASCADE"), primary_key=True)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_products.id", ondelete="CASCADE"), primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class CatalogImage(Base):
    __tablename__ = "catalog_images"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    product_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_products.id", ondelete="CASCADE"))
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_recipes.id", ondelete="CASCADE"))
    file_url: Mapped[str] = mapped_column(Text, nullable=False)
    thumb_url: Mapped[str] = mapped_column(Text, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    alt: Mapped[str | None] = mapped_column(Text)
    focus_y: Mapped[int] = mapped_column(Integer, default=35, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Survey(Base):
    __tablename__ = "surveys"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="draft", nullable=False)
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    content: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    settings: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("survey_versions.id", ondelete="SET NULL", use_alter=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SurveyGroup(Base):
    __tablename__ = "survey_groups"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    survey_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("survey_groups.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    short_title: Mapped[str | None] = mapped_column(Text)
    tint: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class SurveyItem(Base):
    __tablename__ = "survey_items"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    survey_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("survey_groups.id", ondelete="SET NULL"))
    item_type: Mapped[str] = mapped_column(Text, nullable=False)
    product_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_products.id", ondelete="RESTRICT"))
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_recipes.id", ondelete="RESTRICT"))
    display_name: Mapped[str | None] = mapped_column(Text)
    image_override_url: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SurveyVersion(Base):
    __tablename__ = "survey_versions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    survey_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    published_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL"))
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SurveySession(Base):
    __tablename__ = "survey_sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    survey_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("survey_versions.id", ondelete="SET NULL"))
    token_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str] = mapped_column(Text, nullable=False)
    draft: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    draft_revision: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="draft", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SurveyResponse(Base):
    __tablename__ = "survey_responses"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    survey_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("survey_versions.id", ondelete="RESTRICT"), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("survey_sessions.id", ondelete="CASCADE"), unique=True, nullable=False)
    guest_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="SET NULL"))
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str] = mapped_column(Text, nullable=False)
    rating: Mapped[int | None] = mapped_column(Integer)
    adjectives: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    custom_adjectives: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    discomfort: Mapped[str | None] = mapped_column(Text)
    expectation: Mapped[str | None] = mapped_column(Text)
    favorite_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_valid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SurveyResponseItem(Base):
    __tablename__ = "survey_response_items"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    response_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("survey_responses.id", ondelete="CASCADE"), nullable=False)
    item_key: Mapped[str] = mapped_column(Text, nullable=False)
    item_type: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    group_snapshot: Mapped[str | None] = mapped_column(Text)
    favorited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    note_tags: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    note_text: Mapped[str | None] = mapped_column(Text)


class GiftConfig(Base):
    __tablename__ = "gift_configs"
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    gift_name: Mapped[str] = mapped_column(Text, default="", nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[str | None] = mapped_column(Text)
    eligibility: Mapped[str] = mapped_column(Text, default="registered", nullable=False)
    redeem_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GiftClaim(Base):
    __tablename__ = "gift_claims"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    workshop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"), nullable=False)
    survey_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    response_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("survey_responses.id", ondelete="CASCADE"), unique=True, nullable=False)
    guest_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("guests.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(Text, default="issued", nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    short_code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    gift_name_snapshot: Mapped[str] = mapped_column(Text, default="", nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    redeemed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL"))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL"))
    revoke_reason: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GiftAuditLog(Base):
    __tablename__ = "gift_audit_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    workshop_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("workshops.id", ondelete="CASCADE"))
    claim_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("gift_claims.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(Text, nullable=False)
    result: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL"))
    detail: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
