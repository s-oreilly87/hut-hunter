"""add occupant roster and drop adaptersession table

Revision ID: f1a2b3c4d5e6
Revises: e6f7a8b9c0d1
Create Date: 2026-04-21 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "occupant",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("first_name", sa.String(), nullable=False),
        sa.Column("last_name", sa.String(), nullable=False),
        sa.Column("age", sa.Integer(), nullable=False),
        sa.Column("gender", sa.String(), nullable=False),
        sa.Column("country", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.drop_index("ix_adaptersession_adapter_id", table_name="adaptersession")
    op.drop_table("adaptersession")


def downgrade() -> None:
    op.create_table(
        "adaptersession",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("adapter_id", sa.String(), nullable=False),
        sa.Column("encrypted_state", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("adapter_id"),
    )
    op.create_index("ix_adaptersession_adapter_id", "adaptersession", ["adapter_id"])
    op.drop_table("occupant")
