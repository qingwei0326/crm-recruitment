from collections.abc import Callable

from sqlalchemy.engine import Connection

from app.database import (
    _drop_legacy_student_phone_column,
    _drop_message_templates_table,
    _ensure_student_indexes,
    _migrate_admissions_workflow_tables,
    _migrate_dial_recording_state,
    _migrate_follow_up_columns,
    _migrate_legacy_student_stage_values,
    _migrate_legacy_student_status_values,
    _migrate_operation_log_batch_id,
    _migrate_operation_log_nullable,
    _migrate_student_phone_normalization,
    _migrate_student_status_detail,
    _migrate_user_device_tracking,
    _migrate_user_must_change_password,
    _migrate_user_operation_permissions,
    _migrate_user_page_permissions,
    _migrate_user_super_admin,
    _migrate_user_token_version,
)

LegacyMigration = Callable[[Connection], None]

LEGACY_SCHEMA_MIGRATIONS: tuple[LegacyMigration, ...] = (
    _drop_legacy_student_phone_column,
    _migrate_student_phone_normalization,
    _migrate_follow_up_columns,
    _drop_message_templates_table,
    _ensure_student_indexes,
    _migrate_user_token_version,
    _migrate_user_device_tracking,
    _migrate_user_must_change_password,
    _migrate_user_super_admin,
    _migrate_user_page_permissions,
    _migrate_user_operation_permissions,
    _migrate_operation_log_nullable,
    _migrate_operation_log_batch_id,
    _migrate_dial_recording_state,
    _migrate_student_status_detail,
    _migrate_legacy_student_status_values,
    _migrate_legacy_student_stage_values,
    _migrate_admissions_workflow_tables,
)


def run_legacy_schema_compatibility(connection: Connection) -> None:
    for migration in LEGACY_SCHEMA_MIGRATIONS:
        migration(connection)
