"""add WatchJob.last_artifact

Revision ID: c4e9a1d0f2b3
Revises: b7f01d2e8c91
Create Date: 2026-04-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e9a1d0f2b3'
down_revision: Union[str, Sequence[str], None] = 'b7f01d2e8c91'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Adds `last_artifact` (nullable VARCHAR) to hold the relative base path of
    the most recent debug/success snapshot, e.g.
    "artifacts/20260418_123045_doc_great_walk_hold_error". The API builds PNG
    and HTML URLs by appending extensions; files are served via a StaticFiles
    mount at /artifacts/.
    """
    op.add_column(
        'watchjob',
        sa.Column('last_artifact', sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('watchjob', 'last_artifact')
