from datetime import datetime
import uuid

from sqlalchemy import Column, DateTime, String
from sqlmodel import Field, SQLModel

from app.models.job import utcnow


class AppUser(SQLModel, table=True):
    __tablename__ = "app_user"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    email: str = Field(
        sa_column=Column(String, nullable=False, unique=True, index=True),
    )
    password_hash: str
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class UserRegister(SQLModel):
    email: str
    password: str


class UserLogin(SQLModel):
    email: str
    password: str


class UserRead(SQLModel):
    id: str
    email: str
    created_at: datetime

    @classmethod
    def from_db(cls, user: AppUser) -> "UserRead":
        return cls(
            id=user.id,
            email=user.email,
            created_at=user.created_at,
        )
