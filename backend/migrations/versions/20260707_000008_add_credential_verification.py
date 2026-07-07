"""add credential verification (THR-123)

Revision ID: 20260707_000008
Revises: 20260706_000007
Create Date: 2026-07-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260707_000008"
down_revision: Union[str, Sequence[str], None] = "20260706_000007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "adapter_credential",
        sa.Column("is_verified", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "adapter_credential",
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("adapter_credential", "verified_at")
    op.drop_column("adapter_credential", "is_verified")
