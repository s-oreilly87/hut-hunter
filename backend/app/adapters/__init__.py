from app.adapters.base import BaseAdapter
from app.adapters.camis_bc_parks import CamisBcParksAdapter
from app.adapters.camis_ontario_parks import CamisOntarioParksAdapter
from app.adapters.camis_parks_canada import CamisParksCanadaAdapter
from app.adapters.doc_great_walk import DocGreatWalkAdapter
from app.adapters.doc_standard_hut import DocStandardHutAdapter

_REGISTRY: dict[str, type[BaseAdapter]] = {
    DocGreatWalkAdapter.adapter_id: DocGreatWalkAdapter,
    DocStandardHutAdapter.adapter_id: DocStandardHutAdapter,
    CamisBcParksAdapter.adapter_id: CamisBcParksAdapter,
    CamisOntarioParksAdapter.adapter_id: CamisOntarioParksAdapter,
    CamisParksCanadaAdapter.adapter_id: CamisParksCanadaAdapter,
}

def get_adapter(adapter_id: str) -> BaseAdapter:
    cls = _REGISTRY.get(adapter_id)
    if not cls:
        raise ValueError(f"Unknown adapter: {adapter_id}. Available: {list(_REGISTRY.keys())}")
    return cls()


def is_job_expired(adapter_id: str, params: dict) -> bool:
    """Return True if the job's start date has passed the adapter's booking
    cutoff in its local timezone. Returns False for unknown adapters or
    adapters that don't define a booking window."""
    try:
        return get_adapter(adapter_id).is_expired(params)
    except ValueError:
        return False


def adapter_requires_credentials(adapter_id: str) -> bool:
    cls = _REGISTRY.get(adapter_id)
    if cls is None:
        raise ValueError(f"Unknown adapter: {adapter_id}. Available: {list(_REGISTRY.keys())}")
    return bool(cls.requires_credentials)


def adapter_supports_automated_booking(adapter_id: str) -> bool:
    """False for watch/notify-only adapters (IdP-only sign-in — see
    BaseAdapter.supports_automated_booking). Tolerant of unknown adapters
    (returns True) so callers validating other fields surface the real error."""
    cls = _REGISTRY.get(adapter_id)
    return bool(cls.supports_automated_booking) if cls else True


def adapter_has_booking_windows(adapter_id: str) -> bool:
    """True for adapters with a rolling booking window (THR-124 — currently
    the Camis provincial-park adapters). Tolerant of unknown adapters
    (returns False) so callers validating other fields surface the real
    error instead of a window-check false positive."""
    cls = _REGISTRY.get(adapter_id)
    return bool(cls.has_booking_windows) if cls else False


def list_adapters() -> list[dict]:
    return [
        {
            "adapter_id": cls.adapter_id,
            "name": cls.name,
            "param_fields": [f.__dict__ for f in cls.param_fields()],
            "occupant_fields": [f.__dict__ for f in cls.occupant_fields()],
            "requires_credentials": cls.requires_credentials,
            "supports_automated_booking": cls.supports_automated_booking,
            # THR-124: True for adapters where a not-yet-released date is a
            # real, expected state (Camis) — tells the frontend whether it's
            # worth calling POST /jobs/window-check at all.
            "has_booking_windows": cls.has_booking_windows,
            # Expiry metadata — None means the adapter has no booking cutoff.
            # Consumed by the frontend for date validation and by the worker
            # to gate availability checks.
            "booking_timezone": cls.booking_timezone,
            "booking_cutoff_time": cls.booking_cutoff_time.isoformat(),
        }
        for cls in _REGISTRY.values()
    ]
