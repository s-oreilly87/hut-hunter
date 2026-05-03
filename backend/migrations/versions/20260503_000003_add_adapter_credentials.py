"""add adapter credentials

Revision ID: 20260503_000003
Revises: 20260502_000002
Create Date: 2026-05-03 10:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260503_000003"
down_revision: Union[str, Sequence[str], None] = "20260502_000002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "adaptercredential",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("adapter_id", sa.String(), nullable=False),
        sa.Column("encrypted_username", sa.String(), nullable=False),
        sa.Column("encrypted_password", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["appuser.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "adapter_id",
            name="uq_adaptercredential_user_adapter",
        ),
    )
    op.create_index(
        "ix_adaptercredential_adapter_id",
        "adaptercredential",
        ["adapter_id"],
        unique=False,
    )
    op.create_index(
        "ix_adaptercredential_user_id",
        "adaptercredential",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_adaptercredential_user_id", table_name="adaptercredential")
    op.drop_index("ix_adaptercredential_adapter_id", table_name="adaptercredential")
    op.drop_table("adaptercredential")
