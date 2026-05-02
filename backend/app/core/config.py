from dataclasses import dataclass
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = BACKEND_DIR.parent


@dataclass(frozen=True)
class DocCredentials:
    email: str
    password: str


class Settings(BaseSettings):
    app_url: str = "http://localhost:8000"
    database_url: str
    redis_url: str
    secret_key: str
    environment: str = "development"
    gotify_url: str | None = None
    gotify_token: str | None = None
    encryption_key: str

    # Browser control
    # Phase 1 (availability detection) is always headless when this is True.
    # Phase 2 (hold/payment) launches headed so the user can observe/interact via noVNC.
    browser_headless_detect: bool = True
    # X display to point headed Chromium at (e.g. ":99" for Xvfb inside Docker).
    # Leave unset on dev machines so the host's default display is used.
    browser_display: str | None = None

    # Public URL where the noVNC page is served. Embedded into the /pay/{job_id}
    # HTML so the browser can connect to the hold worker's display. Defaults
    # assume localhost for dev; set to the Cloudflare-tunneled domain in prod.
    vnc_url: str = "http://localhost:6080"

    # DOC bookings credentials — used to dismiss the login modal that appears
    # when clicking Reserve without a valid session cookie. If unset, the hold
    # worker will fail when the modal appears.
    doc_email: str | None = None
    doc_password: str | None = None

    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def get_legacy_doc_credentials(self) -> DocCredentials | None:
        if not self.doc_email or not self.doc_password:
            return None
        return DocCredentials(email=self.doc_email, password=self.doc_password)

    @property
    def artifacts_dir(self) -> Path:
        return BACKEND_DIR / "artifacts"

settings = Settings()
