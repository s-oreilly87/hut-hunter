"""Occupant CRUD routes."""

import logging
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.auth import get_current_user
from app.api._route_deps import (
    _get_owned_occupant,
    _validate_adapter_values_payload,
)
from app.core.database import get_session
from app.models.occupant import AdapterOccupant, Occupant, OccupantCreate, OccupantRead, OccupantUpdate
from app.models.job import as_utc
from app.models.user import AppUser

logger = logging.getLogger(__name__)

router = APIRouter()


async def _load_adapter_values_by_occupant_id(
    session: AsyncSession,
    occupant_ids: list[str],
) -> dict[str, dict[str, dict[str, Any]]]:
    if not occupant_ids:
        return {}
    result = await session.execute(
        select(AdapterOccupant)
        .where(AdapterOccupant.occupant_id.in_(occupant_ids))
        .order_by(AdapterOccupant.adapter_id)
    )
    by_occupant_id: dict[str, dict[str, dict[str, Any]]] = {}
    for record in result.scalars().all():
        extra_fields = record.extra_fields if isinstance(record.extra_fields, dict) else {}
        by_occupant_id.setdefault(record.occupant_id, {})[record.adapter_id] = extra_fields
    return by_occupant_id


def _serialize_occupant_from_values(
    occupant: Occupant,
    adapter_values: dict[str, dict[str, Any]] | None = None,
) -> OccupantRead:
    return OccupantRead(
        id=occupant.id,
        first_name=occupant.first_name,
        last_name=occupant.last_name,
        age=occupant.age,
        gender=occupant.gender,
        country=occupant.country,
        adapter_values=adapter_values or {},
        created_at=as_utc(occupant.created_at),
    )


async def _serialize_occupant(session: AsyncSession, occupant: Occupant) -> OccupantRead:
    adapter_values = await _load_adapter_values_by_occupant_id(session, [occupant.id])
    return _serialize_occupant_from_values(occupant, adapter_values.get(occupant.id, {}))


async def _replace_adapter_values_for_occupant(
    session: AsyncSession,
    occupant_id: str,
    adapter_values: dict[str, dict[str, Any]],
) -> None:
    await session.execute(delete(AdapterOccupant).where(AdapterOccupant.occupant_id == occupant_id))
    for adapter_id, extra_fields in adapter_values.items():
        session.add(AdapterOccupant(occupant_id=occupant_id, adapter_id=adapter_id, extra_fields=extra_fields))


@router.get("/occupants", response_model=list[OccupantRead])
async def list_occupants(
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    occupants = (await session.execute(
        select(Occupant).where(Occupant.user_id == current_user.id).order_by(Occupant.created_at)
    )).scalars().all()
    adapter_values = await _load_adapter_values_by_occupant_id(session, [o.id for o in occupants])
    return [_serialize_occupant_from_values(o, adapter_values.get(o.id, {})) for o in occupants]


@router.post("/occupants", response_model=OccupantRead, status_code=201)
async def create_occupant(
    body: OccupantCreate,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    payload = body.model_dump()
    adapter_values = _validate_adapter_values_payload(payload.pop("adapter_values", {}))
    occupant = Occupant(user_id=current_user.id, **payload)
    session.add(occupant)
    await session.flush()
    await _replace_adapter_values_for_occupant(session, occupant.id, adapter_values)
    await session.commit()
    await session.refresh(occupant)
    return await _serialize_occupant(session, occupant)


@router.patch("/occupants/{occupant_id}", response_model=OccupantRead)
async def update_occupant(
    occupant_id: str,
    body: OccupantUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    occupant = await _get_owned_occupant(session, current_user.id, occupant_id)
    patch = body.model_dump(exclude_unset=True)
    adapter_values = None
    if "adapter_values" in patch:
        adapter_values = _validate_adapter_values_payload(patch.pop("adapter_values"))
    for field, value in patch.items():
        setattr(occupant, field, value)
    session.add(occupant)
    if adapter_values is not None:
        await _replace_adapter_values_for_occupant(session, occupant.id, adapter_values)
    await session.commit()
    await session.refresh(occupant)
    return await _serialize_occupant(session, occupant)


@router.delete("/occupants/{occupant_id}", status_code=204)
async def delete_occupant(
    occupant_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
):
    occupant = await _get_owned_occupant(session, current_user.id, occupant_id)
    await session.execute(delete(AdapterOccupant).where(AdapterOccupant.occupant_id == occupant.id))
    await session.delete(occupant)
    await session.commit()
    return None
