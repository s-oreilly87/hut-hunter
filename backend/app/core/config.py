from pathlib import Path
from pydantic_settings import BaseSettings

ROOT_DIR = Path(__file__).parent.parent.parent.parent

class Settings(BaseSettings):
    app_url: str = "http://localhost:8000"
    database_url: str
    redis_url: str
    secret_key: str
    environment: str = "development"
    gotify_url: str | None = None
    gotify_token: str | None = None
    encryption_key: str

    model_config = {
        "env_file": str(ROOT_DIR / ".env")
    }

# Single instance imported everywhere
settings = Settings()