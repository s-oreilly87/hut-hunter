"""drop adaptersession table

Revision ID: f1a2b3c4d5e6
Revises: e6f7a8b9c0d1
Create Date: 2026-04-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import DateTime


# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'e6f7a8b9c0d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table('adaptersession')


def downgrade() -> None:
    op.create_table(
        'adaptersession',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('adapter_id', sa.String(), nullable=False),
        sa.Column('encrypted_state', sa.String(), nullable=False),
        sa.Column('created_at', DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('adapter_id'),
    )
    op.create_index('ix_adaptersession_adapter_id', 'adaptersession', ['adapter_id'])
