"""watchjob artifact history

Revision ID: e6f7a8b9c0d1
Revises: d5f8a2c1e4b7
Create Date: 2026-04-19 19:05:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, Sequence[str], None] = "d5f8a2c1e4b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("watchjob", sa.Column("artifact_history", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("watchjob", "artifact_history")
