"""add adapter/cart session tables

Revision ID: 05e6184ab0ff
Revises: 757cf0c68bd0
Create Date: 2026-04-17 15:44:16.043783
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "05e6184ab0ff"
down_revision: Union[str, Sequence[str], None] = "757cf0c68bd0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "adaptersession",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("adapter_id", sa.String(), nullable=False),
        sa.Column("encrypted_state", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_adaptersession_adapter_id", "adaptersession", ["adapter_id"], unique=True)

    op.create_table(
        "cartsession",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("job_id", sa.String(), nullable=False),
        sa.Column("encrypted_cookies", sa.String(), nullable=False),
        sa.Column("cart_url", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cartsession_job_id", "cartsession", ["job_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_cartsession_job_id", table_name="cartsession")
    op.drop_table("cartsession")
    op.drop_index("ix_adaptersession_adapter_id", table_name="adaptersession")
    op.drop_table("adaptersession")
