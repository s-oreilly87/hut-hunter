"""replace WatchJob.is_active with status enum

Revision ID: b7f01d2e8c91
Revises: a1b2c3d4e5f6
Create Date: 2026-04-18 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b7f01d2e8c91"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "watchjob",
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="paused",
        ),
    )
    op.create_index("ix_watchjob_status", "watchjob", ["status"])
    op.drop_column("watchjob", "is_active")


def downgrade() -> None:
    op.add_column(
        "watchjob",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.drop_index("ix_watchjob_status", table_name="watchjob")
    op.drop_column("watchjob", "status")
