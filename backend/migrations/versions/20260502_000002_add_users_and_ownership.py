"""add users and ownership

Revision ID: 20260502_000002
Revises: 20260502_000001
Create Date: 2026-05-02 21:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260502_000002"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "appuser",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_appuser_email", "appuser", ["email"], unique=True)

    op.add_column("watchjob", sa.Column("user_id", sa.String(), nullable=True))
    op.create_index("ix_watchjob_user_id", "watchjob", ["user_id"], unique=False)
    op.create_foreign_key(
        "fk_watchjob_user_id_appuser",
        "watchjob",
        "appuser",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column("occupant", sa.Column("user_id", sa.String(), nullable=True))
    op.create_index("ix_occupant_user_id", "occupant", ["user_id"], unique=False)
    op.create_foreign_key(
        "fk_occupant_user_id_appuser",
        "occupant",
        "appuser",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_occupant_user_id_appuser", "occupant", type_="foreignkey")
    op.drop_index("ix_occupant_user_id", table_name="occupant")
    op.drop_column("occupant", "user_id")

    op.drop_constraint("fk_watchjob_user_id_appuser", "watchjob", type_="foreignkey")
    op.drop_index("ix_watchjob_user_id", table_name="watchjob")
    op.drop_column("watchjob", "user_id")

    op.drop_index("ix_appuser_email", table_name="appuser")
    op.drop_table("appuser")
