from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"  # development | test | production
    database_url: str = "sqlite:///./docuextract.db"
    jwt_secret: str = "dev-only-insecure-secret-change-me-0123456789"  # noqa: S105
    jwt_ttl_minutes: int = 60 * 12
    cors_origins: list[str] = ["http://localhost:5173"]

    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_timeout_seconds: int = 60

    # Cost guard for public deployments: Gemini attempts per UTC day (retries count).
    ai_daily_limit_per_user: int = 20
    ai_daily_limit_global: int = 200

    # Public URL of the frontend, used to build links in emails.
    app_url: str = "http://localhost:5173"
    # Outgoing email for password resets (any SMTP provider). Empty host = no email.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "DocuExtract AI <no-reply@localhost>"
    password_reset_ttl_minutes: int = 30

    # Behind a reverse proxy (Vercel): a shared secret the proxy adds to every request as
    # `X-Origin-Secret`. When set, requests without it are refused, so nobody can bypass the
    # proxy and forge client-IP headers. CLIENT_IP_HEADER (e.g. x-real-ip) is then trusted.
    origin_secret: str = ""
    client_ip_header: str = ""

    max_upload_mb: int = 10
    max_pdf_pages: int = 30
    extraction_max_attempts: int = 3
    extraction_backoff_seconds: float = 1.0

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def password_reset_enabled(self) -> bool:
        # Without SMTP, development prints the link to the server log; production disables it.
        return bool(self.smtp_host) or not self.is_production

    @property
    def demo_mode(self) -> bool:
        return not self.gemini_api_key


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.is_production and (s.jwt_secret.startswith("dev-only") or len(s.jwt_secret) < 32):
        raise RuntimeError("JWT_SECRET must be set to a random value of 32+ chars in production")
    if s.client_ip_header and len(s.origin_secret) < 32:
        # Without the origin lock anyone can send that header and pick their own IP.
        raise RuntimeError("CLIENT_IP_HEADER requires ORIGIN_SECRET (32+ chars)")
    return s
