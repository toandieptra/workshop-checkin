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

    UPLOAD_DIR: str = "/uploads"
    MAX_UPLOAD_FILE_BYTES: int = 10 * 1024 * 1024

    # Danh sách chi nhánh cố định (phân tách bằng dấu phẩy) — lấy từ Larkbase.
    WORKSHOP_BRANCHES: str = "Hà Nội,Sài Gòn"

    PUBLIC_BASE_URL: str | None = None

    # ===== Lark Base sync =====
    LARK_APP_ID: str | None = None
    LARK_APP_SECRET: str | None = None
    LARK_DOMAIN: str = "larksuite.com"
    LARK_BASE_TOKEN: str | None = None
    LARK_TABLE_REGISTRATIONS: str | None = None
    LARK_TABLE_WORKSHOPS: str | None = None
    LARK_WRITEBACK_ENABLED: bool = True

    # ===== Lark OAuth / backend admin auth =====
    LARK_OAUTH_REDIRECT_URI: str | None = None
    LARK_ALLOWED_TENANT_KEYS: str = "145765cccf8c5743"
    AUTH_SESSION_COOKIE: str = "workshop_admin_session"
    AUTH_SESSION_TTL_SECONDS: int = 604800
    AUTH_COOKIE_SECURE: bool = True
    AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL: str | None = None

    # ===== Lark organization directory sync =====
    LARK_DIRECTORY_SYNC_ENABLED: bool = True
    LARK_DIRECTORY_SYNC_INTERVAL_SECONDS: int = 3600

    # ===== Check-in dedup =====
    CHECKIN_DEDUP_TTL_SECONDS: int = 3000

    # ===== Background sync =====
    LARK_SYNC_INTERVAL_SECONDS: int = 30

    # ===== Zalo Business Solutions / ZBS =====
    ZBS_ENABLED: bool = False
    ZBS_API_URL: str = "https://business.openapi.zalo.me/message/template"
    ZBS_APP_ID: str | None = None
    ZBS_APP_SECRET: str | None = None
    ZBS_ACCESS_TOKEN: str | None = None
    ZBS_REFRESH_TOKEN: str | None = None
    ZBS_REGISTRATION_TEMPLATE_ID: str | None = None
    ZBS_WEBHOOK_SECRET: str | None = None
    ZBS_WORKER_INTERVAL_SECONDS: int = 5
    ZBS_REQUEST_TIMEOUT_SECONDS: float = 10.0

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

    @property
    def lark_allowed_tenant_keys(self) -> set[str]:
        return {value.strip() for value in self.LARK_ALLOWED_TENANT_KEYS.split(",") if value.strip()}


settings = Settings()
