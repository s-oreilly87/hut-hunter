import logging
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


def adapter_park_url(adapter_id: str, params: dict) -> str | None:
    """THR-129 item 2: deep-link to the adapter's results page for these job
    params, or None if the adapter doesn't support one / params aren't
    resolvable yet. Tolerant of unknown adapters and of any error the
    adapter's ``results_url`` raises — a broken link builder must never
    break job serialization, it should just omit the link."""
    try:
        adapter = get_adapter(adapter_id)
    except ValueError:
        return None
    try:
        return adapter.results_url(params)
    except Exception:
        logging.getLogger(__name__).exception(
            "results_url failed for adapter %s — omitting park_url", adapter_id,
        )
        return None


def adapter_has_booking_windows(adapter_id: str) -> bool:
    """True for adapters with a rolling booking window (THR-124 — currently
    the Camis provincial-park adapters). Tolerant of unknown adapters
    (returns False) so callers validating other fields surface the real
    error instead of a window-check false positive."""
    cls = _REGISTRY.get(adapter_id)
    return bool(cls.has_booking_windows) if cls else False


def credential_key_for_adapter(adapter_id: str) -> str:
    """The key stored credentials are actually keyed by (THR-126).

    Most adapters key by their own adapter_id. Adapters that declare a
    ``credential_realm`` (the two DOC adapters — both bookings.doc.govt.nz
    accounts) share one key so one saved+verified sign-in covers the whole
    realm. Unknown adapters degrade to their literal id — same fail-open
    posture as the rest of this module.
    """
    cls = _REGISTRY.get(adapter_id)
    if cls is None:
        return adapter_id
    return cls.credential_realm or adapter_id


def adapter_ids_for_credential_key(key: str) -> list[str]:
    """Every concrete adapter_id that resolves to ``key`` (THR-126).

    Inverse of ``credential_key_for_adapter`` — used to expand a stored
    credential row's key back into the set of adapters it actually covers
    (for ``credentials_configured`` checks) and to pick a canonical, real
    adapter_id to display a shared-realm credential under (the API/UI never
    show the bare realm string — see ``_credential_record_to_read``).
    Degrades to ``[key]`` if nothing in the registry maps to it (e.g. stale
    data from a removed adapter) so callers never get an empty set back.
    """
    ids = [aid for aid in _REGISTRY if credential_key_for_adapter(aid) == key]
    return ids or [key]


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
            # THR-126: non-null when this adapter shares a saved sign-in with
            # one or more other adapters (e.g. both DOC adapters are
            # "doc_govt_nz") — the frontend groups adapters with the same
            # realm into a single Sign-Ins card.
            "credential_realm": cls.credential_realm,
            # THR-129 item 3: True when this site books under one named
            # permit holder rather than each occupant individually — tells
            # the wizard whether to show a holder picker for multi-camper
            # jobs.
            "uses_single_permit_holder": cls.uses_single_permit_holder,
            # Expiry metadata — None means the adapter has no booking cutoff.
            # Consumed by the frontend for date validation and by the worker
            # to gate availability checks.
            "booking_timezone": cls.booking_timezone,
            "booking_cutoff_time": cls.booking_cutoff_time.isoformat(),
        }
        for cls in _REGISTRY.values()
    ]
