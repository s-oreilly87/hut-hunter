"""credential verification status + message (THR-126)

Revision ID: 20260707_000009
Revises: 20260707_000008
Create Date: 2026-07-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260707_000009"
down_revision: Union[str, Sequence[str], None] = "20260707_000008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "adapter_credential",
        sa.Column(
            "verification_status",
            sa.String(),
            nullable=False,
            server_default="unverified",
        ),
    )
    op.add_column(
        "adapter_credential",
        sa.Column("verification_message", sa.String(), nullable=True),
    )
    # Backfill from the existing is_verified boolean so rows saved before this
    # migration still show the right badge instead of reverting to
    # "unverified" (only a genuine never-checked row should read that way).
    op.execute(
        "UPDATE adapter_credential SET verification_status = 'verified' WHERE is_verified = true"
    )
    op.execute(
        "UPDATE adapter_credential SET verification_status = 'failed' WHERE is_verified = false"
    )


def downgrade() -> None:
    op.drop_column("adapter_credential", "verification_message")
    op.drop_column("adapter_credential", "verification_status")
