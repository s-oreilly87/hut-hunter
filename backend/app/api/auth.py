from datetime import timedelta
from typing import cast

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.config import settings
from app.core.database import get_session
from app.core.security import ALGORITHM, create_access_token, hash_password, verify_password
from app.models.user import AppUser, UserLogin, UserRead, UserRegister

AUTH_COOKIE_NAME = "hut_hunter_session"
ACCESS_TOKEN_EXPIRE_DAYS = 7
MIN_PASSWORD_LENGTH = 8

auth_router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _validate_credentials(email: str, password: str) -> tuple[str, str]:
    normalized_email = _normalize_email(email)
    if "@" not in normalized_email or normalized_email.startswith("@") or normalized_email.endswith("@"):
        raise HTTPException(status_code=422, detail="A valid email address is required.")
    trimmed_password = password.strip()
    if len(trimmed_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
        )
    return normalized_email, trimmed_password


def _set_auth_cookie(response: Response, user_id: str) -> None:
    token = create_access_token(
        subject=user_id,
        expires_delta=timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS),
    )
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        max_age=int(timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS).total_seconds()),
        samesite="lax",
        secure=settings.environment == "production",
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=settings.environment == "production",
        path="/",
    )


async def get_current_user(
    session: AsyncSession = Depends(get_session),
    token: str | None = Cookie(default=None, alias=AUTH_COOKIE_NAME),
) -> AppUser:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session",
        ) from exc

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    user = cast(AppUser | None, await session.get(AppUser, user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return user


@auth_router.post("/register", response_model=UserRead, status_code=201)
async def register(
    body: UserRegister,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    email, password = _validate_credentials(body.email, body.password)

    existing = (
        await session.execute(select(AppUser).where(AppUser.email == email))
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with that email already exists.")

    user = AppUser(
        email=email,
        password_hash=hash_password(password),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    _set_auth_cookie(response, user.id)
    return UserRead.from_db(user)


@auth_router.post("/login", response_model=UserRead)
async def login(
    body: UserLogin,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    email = _normalize_email(body.email)
    user = (
        await session.execute(select(AppUser).where(AppUser.email == email))
    ).scalars().first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    _set_auth_cookie(response, user.id)
    return UserRead.from_db(user)


@auth_router.post("/logout", status_code=204)
async def logout(response: Response):
    clear_auth_cookie(response)
    return None


@auth_router.get("/me", response_model=UserRead)
async def get_me(current_user: AppUser = Depends(get_current_user)):
    return UserRead.from_db(current_user)
