"""watchjob booking window (THR-124)

Revision ID: 20260706_000007
Revises: 20260510_000006
Create Date: 2026-07-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260706_000007"
down_revision: Union[str, Sequence[str], None] = "20260510_000006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "watch_job",
        sa.Column("window_opens_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "watch_job",
        sa.Column(
            "window_opens_precise", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    )
    op.add_column(
        "watch_job",
        sa.Column("window_burst_until", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("watch_job", "window_burst_until")
    op.drop_column("watch_job", "window_opens_precise")
    op.drop_column("watch_job", "window_opens_at")
