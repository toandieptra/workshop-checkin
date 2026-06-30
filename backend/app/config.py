from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    POSTGRES_USER: str = "workshop"
    POSTGRES_PASSWORD: str = "workshop"
    POSTGRES_DB: str = "workshop_checkin"
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379

    FACE_API_URL: str = "http://face-api:8428"

    AUTO_CHECKIN_THRESHOLD: float = 0.62
    MANUAL_CONFIRM_THRESHOLD: float = 0.55
    REJECT_THRESHOLD: float = 0.55
    ENABLE_STAFF_CONFIRMATION: bool = True
    CHECKIN_DEDUP_TTL_SECONDS: int = 600
    SAVE_CHECKIN_SNAPSHOTS: bool = True
    MIN_QUALITY_SCORE: float = 0.30

    UPLOAD_DIR: str = "/uploads"

    PUBLIC_BASE_URL: str | None = None  # neu None -> su request.base_url (dev/LAN)

    MAX_FACE_IMAGES_PER_GUEST: int = 3       # ảnh tham chiếu (admin/QR upload)
    MAX_CHECKIN_SNAPSHOTS_PER_GUEST: int = 2  # ảnh check-in (rolling window: chi luu 2 moi nhat)
    MAX_UPLOAD_FILE_BYTES: int = 10 * 1024 * 1024

    # ===== Lark Base sync =====
    LARK_APP_ID: str | None = None
    LARK_APP_SECRET: str | None = None
    LARK_DOMAIN: str = "larksuite.com"  # larksuite.com | feishu.cn
    LARK_BASE_TOKEN: str | None = None
    LARK_TABLE_REGISTRATIONS: str | None = None  # bang dang ky
    LARK_TABLE_WORKSHOPS: str | None = None  # bang cau hinh
    LARK_WRITEBACK_ENABLED: bool = True

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def redis_url(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"

    @property
    def lark_base_url(self) -> str:
        return f"https://open.{self.LARK_DOMAIN}/open-apis"


settings = Settings()
