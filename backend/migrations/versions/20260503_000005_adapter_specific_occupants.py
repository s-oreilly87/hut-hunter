"""move adapter-specific occupant fields out of occupants

Revision ID: 20260503_000005
Revises: 20260503_000004
Create Date: 2026-05-03 16:15:00.000000
"""

from __future__ import annotations

import json
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260503_000005"
down_revision: Union[str, Sequence[str], None] = "20260503_000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "adapter_occupant",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("occupant_id", sa.String(), nullable=False),
        sa.Column("adapter_id", sa.String(), nullable=False),
        sa.Column("extra_fields", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["occupant_id"], ["occupant.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "occupant_id",
            "adapter_id",
            name="uq_adapter_occupant_occupant_id_adapter_id",
        ),
    )
    op.create_index(
        "ix_adapter_occupant_adapter_id",
        "adapter_occupant",
        ["adapter_id"],
        unique=False,
    )
    op.create_index(
        "ix_adapter_occupant_occupant_id",
        "adapter_occupant",
        ["occupant_id"],
        unique=False,
    )

    bind = op.get_bind()
    occupant_rows = bind.execute(
        sa.text(
            "SELECT id, category, created_at FROM occupant "
            "WHERE category IS NOT NULL AND TRIM(category) <> ''"
        )
    ).fetchall()
    for row in occupant_rows:
        bind.execute(
            sa.text(
                "INSERT INTO adapter_occupant "
                "(id, occupant_id, adapter_id, extra_fields, created_at, updated_at) "
                "VALUES ("
                ":id, "
                ":occupant_id, "
                ":adapter_id, "
                "CAST(:extra_fields AS JSON), "
                ":created_at, "
                ":updated_at"
                ")"
            ),
            {
                "id": str(uuid.uuid4()),
                "occupant_id": row.id,
                "adapter_id": "doc_great_walk",
                "extra_fields": json.dumps({"category": row.category}),
                "created_at": row.created_at,
                "updated_at": row.created_at,
            },
        )

    with op.batch_alter_table("occupant") as batch_op:
        batch_op.drop_column("category")


def downgrade() -> None:
    with op.batch_alter_table("occupant") as batch_op:
        batch_op.add_column(sa.Column("category", sa.String(), nullable=True))

    bind = op.get_bind()
    adapter_rows = bind.execute(
        sa.text(
            "SELECT occupant_id, extra_fields FROM adapter_occupant "
            "WHERE adapter_id = :adapter_id"
        ),
        {"adapter_id": "doc_great_walk"},
    ).fetchall()
    for row in adapter_rows:
        extra_fields = row.extra_fields if isinstance(row.extra_fields, dict) else {}
        category = extra_fields.get("category")
        if not isinstance(category, str):
            continue
        bind.execute(
            sa.text(
                "UPDATE occupant SET category = :category WHERE id = :occupant_id"
            ),
            {
                "category": category,
                "occupant_id": row.occupant_id,
            },
        )

    bind.execute(sa.text("UPDATE occupant SET category = '' WHERE category IS NULL"))

    with op.batch_alter_table("occupant") as batch_op:
        batch_op.alter_column("category", existing_type=sa.String(), nullable=False)

    op.drop_index("ix_adapter_occupant_occupant_id", table_name="adapter_occupant")
    op.drop_index("ix_adapter_occupant_adapter_id", table_name="adapter_occupant")
    op.drop_table("adapter_occupant")
