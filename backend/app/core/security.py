from datetime import timedelta

from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.models.job import utcnow

ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str, expires_delta: timedelta) -> str:
    expires_at = utcnow() + expires_delta
    return jwt.encode(
        {
            "sub": subject,
            "exp": expires_at,
        },
        settings.secret_key,
        algorithm=ALGORITHM,
    )
