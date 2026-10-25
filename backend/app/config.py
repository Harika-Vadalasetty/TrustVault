"""Application settings loaded from environment variables.

The API process is allowed to start without DATABASE_URL or Supabase
credentials so the skeleton and GET /health can be inspected. Database
migrations, /health/db, and later features call require_* helpers and
fail with a clear error if those values are missing.
"""

import re
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "TrustVault"
    environment: str = "development"
    frontend_origin: str = "http://localhost:5173"

    database_url: str | None = None

    supabase_url: str | None = None
    supabase_service_role_key: str | None = None
    supabase_storage_bucket: str = "documents"

    session_secret: str | None = None
    session_ttl_minutes: int = 480
    cookie_secure: bool = False
    cookie_samesite: str = "lax"

    max_upload_bytes: int = 10 * 1024 * 1024
    allowed_extensions: str = "pdf,png,jpg,jpeg,docx,txt"
    storage_dir: str = "storage_local"

    demo_password: str | None = None

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "noreply@trustvault.local"
    smtp_use_tls: bool = True

    log_level: str = Field(default="INFO")

    @field_validator(
        "database_url",
        "supabase_url",
        "supabase_service_role_key",
        "session_secret",
        "demo_password",
        "smtp_host",
        "smtp_username",
        "smtp_password",
        mode="before",
    )
    @classmethod
    def empty_string_to_none(cls, value: object) -> object:
        if isinstance(value, str):
            cleaned = value.strip().strip("'\"")
            if cleaned == "":
                return None
            return cleaned
        return value

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def database_configured(self) -> bool:
        return bool(self.database_url)

    @property
    def storage_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def email_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_username)

    def require_database_url(self) -> str:
        if not self.database_url:
            raise RuntimeError(
                "DATABASE_URL is not set. Copy .env.example to .env and add your "
                "Supabase PostgreSQL URI before running migrations or DB features."
            )
        return self.database_url

    def require_session_secret(self) -> str:
        if not self.session_secret:
            raise RuntimeError(
                "SESSION_SECRET is not configured. Set SESSION_SECRET in your environment "
                "or .env file before using session or CSRF features."
            )
        if len(self.session_secret) < 32:
            raise ValueError(
                "SESSION_SECRET must be at least 32 characters long."
            )
        return self.session_secret

    def sqlalchemy_url(self) -> str:
        """Return a SQLAlchemy URL using the psycopg (v3) driver."""
        url = self.require_database_url().strip().strip("'\"")

        # Resolve Supabase direct connection IPv6 issue on cloud platforms without IPv6 (such as Render free tier).
        # Direct hostname "db.<ref>.supabase.co" has no IPv4 A-record, causing "[Errno -2] Name or service not known".
        # Automatically bridge direct connections to the IPv4-compatible Supabase Pooler.
        supabase_match = re.search(r"@db\.([a-z0-9_-]+)\.supabase\.co(?::\d+)?", url)
        if supabase_match:
            project_ref = supabase_match.group(1)
            # Default pooler host for ap-south-1 Supabase instance
            pooler_host = "aws-0-ap-south-1.pooler.supabase.com:5432"
            url = re.sub(r"@db\.[a-z0-9_-]+\.supabase\.co(?::\d+)?", f"@{pooler_host}", url)
            if "://postgres:" in url:
                url = url.replace("://postgres:", f"://postgres.{project_ref}:")

        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        elif url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://") :]

        # Enforce SSL for remote PostgreSQL hosts (e.g. Supabase, Render, AWS RDS)
        if "sslmode" not in url and ("supabase" in url or "amazonaws" in url or "render" in url or "pooler" in url):
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}sslmode=require"

        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
