"""initial schema

Revision ID: 20260502_000001
Revises:
Create Date: 2026-05-02 19:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260502_000001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "watchjob",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("adapter_id", sa.String(), nullable=False),
        sa.Column("params", sa.String(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="paused"),
        sa.Column("auto_book", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("enable_monitoring", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("interval_minutes", sa.Integer(), nullable=False, server_default=sa.text("15")),
        sa.Column("next_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_result", sa.String(), nullable=True),
        sa.Column("last_artifact", sa.String(), nullable=True),
        sa.Column("artifact_history", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_watchjob_status", "watchjob", ["status"])
    op.create_index("ix_watchjob_next_check_at", "watchjob", ["next_check_at"])

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

    op.create_table(
        "cartsession",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("job_id", sa.String(), nullable=False),
        sa.Column("encrypted_cookies", sa.String(), nullable=False),
        sa.Column("cart_url", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cartsession_job_id", "cartsession", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_cartsession_job_id", table_name="cartsession")
    op.drop_table("cartsession")

    op.drop_table("occupant")

    op.drop_index("ix_watchjob_next_check_at", table_name="watchjob")
    op.drop_index("ix_watchjob_status", table_name="watchjob")
    op.drop_table("watchjob")
