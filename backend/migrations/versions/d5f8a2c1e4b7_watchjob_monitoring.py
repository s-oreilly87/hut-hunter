"""add WatchJob monitoring fields

Revision ID: d5f8a2c1e4b7
Revises: c4e9a1d0f2b3
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5f8a2c1e4b7'
down_revision: Union[str, Sequence[str], None] = 'c4e9a1d0f2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Adds three columns to watchjob backing the periodic-polling flow:

      • enable_monitoring (bool, default false for existing rows) — when true
        the scheduler tick periodically enqueues check_availability.
      • interval_minutes (int, default 15) — minutes between scheduled checks.
      • next_check_at (timestamptz, nullable) — when the scheduler should next
        dispatch; compared against utcnow() on every tick.

    Existing rows default to enable_monitoring=false so current manual-trigger
    behavior is preserved until the user opts in via the edit dialog.
    """
    op.add_column(
        'watchjob',
        sa.Column(
            'enable_monitoring',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        'watchjob',
        sa.Column(
            'interval_minutes',
            sa.Integer(),
            nullable=False,
            server_default=sa.text('15'),
        ),
    )
    op.add_column(
        'watchjob',
        sa.Column(
            'next_check_at',
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    # Scheduler tick queries next_check_at on every pass; an index pays off
    # once there are more than a handful of monitored jobs.
    op.create_index(
        'ix_watchjob_next_check_at',
        'watchjob',
        ['next_check_at'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_watchjob_next_check_at', table_name='watchjob')
    op.drop_column('watchjob', 'next_check_at')
    op.drop_column('watchjob', 'interval_minutes')
    op.drop_column('watchjob', 'enable_monitoring')
