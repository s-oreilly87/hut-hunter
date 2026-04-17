from cryptography.fernet import Fernet
from app.core.config import settings

def get_fernet() -> Fernet:
    return Fernet(settings.encryption_key.encode())

def encrypt(data: str) -> str:
    return get_fernet().encrypt(data.encode()).decode()

def decrypt(data: str) -> str:
    return get_fernet().decrypt(data.encode()).decode()