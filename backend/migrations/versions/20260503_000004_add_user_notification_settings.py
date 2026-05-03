"""add user notification settings

Revision ID: 20260503_000004
Revises: 20260503_000003
Create Date: 2026-05-03 12:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260503_000004"
down_revision: Union[str, Sequence[str], None] = "20260503_000003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "usernotificationsettings",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("email_enabled", sa.Boolean(), nullable=False),
        sa.Column("encrypted_email_address", sa.String(), nullable=True),
        sa.Column("gotify_enabled", sa.Boolean(), nullable=False),
        sa.Column("encrypted_gotify_url", sa.String(), nullable=True),
        sa.Column("encrypted_gotify_token", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["appuser.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_usernotificationsettings_user_id",
        "usernotificationsettings",
        ["user_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_usernotificationsettings_user_id",
        table_name="usernotificationsettings",
    )
    op.drop_table("usernotificationsettings")
