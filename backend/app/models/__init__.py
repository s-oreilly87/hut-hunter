"""Central model registration for SQLModel metadata.

Importing this package must register every table model so any process that
touches SQLModel metadata (API, workers, Alembic, tests) sees the complete
schema graph, including cross-table foreign keys.
"""

from app.models import job, occupant, session, user

__all__ = [
    "job",
    "occupant",
    "session",
    "user",
]
