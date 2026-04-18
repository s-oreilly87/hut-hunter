"""add completed_at to cartsession

Revision ID: a1b2c3d4e5f6
Revises: 05e6184ab0ff
Create Date: 2026-04-17 23:47:56.641530

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '05e6184ab0ff'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'cartsession',
        sa.Column(
            'completed_at',
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('cartsession', 'completed_at')
