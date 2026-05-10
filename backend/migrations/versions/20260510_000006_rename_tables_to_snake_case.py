"""rename tables to snake_case

Revision ID: 20260510_000006
Revises: 20260503_000005
Create Date: 2026-05-10
"""
from typing import Union, Sequence

from alembic import op


revision: str = "20260510_000006"
down_revision: Union[str, Sequence[str], None] = "20260503_000005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Rename tables ---
    # appuser first — other tables have FKs pointing at it and PostgreSQL
    # tracks those by OID, so renaming is safe before touching the others.
    op.rename_table("appuser", "app_user")
    op.rename_table("watchjob", "watch_job")
    op.rename_table("cartsession", "cart_session")
    op.rename_table("adaptercredential", "adapter_credential")
    op.rename_table("usernotificationsettings", "user_notification_settings")

    # --- Rename indexes ---
    op.execute("ALTER INDEX ix_appuser_email RENAME TO ix_app_user_email")
    op.execute("ALTER INDEX ix_watchjob_user_id RENAME TO ix_watch_job_user_id")
    op.execute("ALTER INDEX ix_watchjob_status RENAME TO ix_watch_job_status")
    op.execute("ALTER INDEX ix_watchjob_next_check_at RENAME TO ix_watch_job_next_check_at")
    op.execute("ALTER INDEX ix_cartsession_job_id RENAME TO ix_cart_session_job_id")
    op.execute("ALTER INDEX ix_adaptercredential_user_id RENAME TO ix_adapter_credential_user_id")
    op.execute("ALTER INDEX ix_adaptercredential_adapter_id RENAME TO ix_adapter_credential_adapter_id")
    op.execute(
        "ALTER INDEX ix_usernotificationsettings_user_id "
        "RENAME TO ix_user_notification_settings_user_id"
    )

    # --- Rename named FK constraints ---
    # These were created with explicit names in earlier migrations.
    op.execute(
        "ALTER TABLE watch_job "
        "RENAME CONSTRAINT fk_watchjob_user_id_appuser "
        "TO fk_watch_job_user_id_app_user"
    )
    op.execute(
        "ALTER TABLE occupant "
        "RENAME CONSTRAINT fk_occupant_user_id_appuser "
        "TO fk_occupant_user_id_app_user"
    )

    # --- Rename named unique constraint ---
    op.execute(
        "ALTER TABLE adapter_credential "
        "RENAME CONSTRAINT uq_adaptercredential_user_adapter "
        "TO uq_adapter_credential_user_adapter"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE adapter_credential "
        "RENAME CONSTRAINT uq_adapter_credential_user_adapter "
        "TO uq_adaptercredential_user_adapter"
    )
    op.execute(
        "ALTER TABLE occupant "
        "RENAME CONSTRAINT fk_occupant_user_id_app_user "
        "TO fk_occupant_user_id_appuser"
    )
    op.execute(
        "ALTER TABLE watch_job "
        "RENAME CONSTRAINT fk_watch_job_user_id_app_user "
        "TO fk_watchjob_user_id_appuser"
    )

    op.execute(
        "ALTER INDEX ix_user_notification_settings_user_id "
        "RENAME TO ix_usernotificationsettings_user_id"
    )
    op.execute("ALTER INDEX ix_adapter_credential_adapter_id RENAME TO ix_adaptercredential_adapter_id")
    op.execute("ALTER INDEX ix_adapter_credential_user_id RENAME TO ix_adaptercredential_user_id")
    op.execute("ALTER INDEX ix_cart_session_job_id RENAME TO ix_cartsession_job_id")
    op.execute("ALTER INDEX ix_watch_job_next_check_at RENAME TO ix_watchjob_next_check_at")
    op.execute("ALTER INDEX ix_watch_job_status RENAME TO ix_watchjob_status")
    op.execute("ALTER INDEX ix_watch_job_user_id RENAME TO ix_watchjob_user_id")
    op.execute("ALTER INDEX ix_app_user_email RENAME TO ix_appuser_email")

    op.rename_table("user_notification_settings", "usernotificationsettings")
    op.rename_table("adapter_credential", "adaptercredential")
    op.rename_table("cart_session", "cartsession")
    op.rename_table("watch_job", "watchjob")
    op.rename_table("app_user", "appuser")
