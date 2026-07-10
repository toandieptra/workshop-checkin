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

    # ===== Check-in dedup =====
    CHECKIN_DEDUP_TTL_SECONDS: int = 3000

    # ===== Background sync =====
    LARK_SYNC_INTERVAL_SECONDS: int = 30

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
