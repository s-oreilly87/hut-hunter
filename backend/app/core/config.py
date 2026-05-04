from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    app_url: str = "http://localhost:8000"
    database_url: str
    redis_url: str
    secret_key: str
    environment: str = "development"
    encryption_key: str
    smtp_host: str | None = None
    smtp_port: int = 1025
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "noreply@hut-hunter.local"
    smtp_from_name: str = "Hut Hunter"
    smtp_use_ssl: bool = False
    smtp_use_starttls: bool = False

    # Browser control
    # Phase 1 (availability detection) is always headless when this is True.
    # Phase 2 (hold/payment) launches headed so the user can observe/interact
    # via noVNC.
    browser_headless_detect: bool = True
    # X display to point headed Chromium at (e.g. ":99" for Xvfb inside Docker).
    # Leave unset on dev machines so the host's default display is used.
    browser_display: str | None = None

    # Public noVNC endpoint configuration used by /pay/{job_id}. When VNC_URL
    # is set, it is used as an absolute override. Otherwise the pay page uses
    # the current request host with VNC_PORT.
    vnc_url: str | None = None
    vnc_port: int = 6080

    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def artifacts_dir(self) -> Path:
        return BACKEND_DIR / "artifacts"


settings = Settings()
