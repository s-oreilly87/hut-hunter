from pathlib import Path
from pydantic_settings import BaseSettings

ROOT_DIR = Path(__file__).parent.parent.parent.parent

class Settings(BaseSettings):
    database_url: str
    redis_url: str
    secret_key: str
    environment: str = "development"

    model_config = {
        "env_file": str(ROOT_DIR / ".env")
    }

# Single instance imported everywhere
settings = Settings()