SCORE_DAILY_CALL_TARGET_MAX = 1000

ALLOWED_CONFIG_KEYS = {
    "pushplus_token",
    "stale_days",
    "follow_up_window_minutes",
    "score_daily_call_target",
    "assignment_capacity_lookback_days",
    "assignment_capacity_observed_days",
    "assignment_capacity_min",
    "assignment_capacity_max",
    "assignment_capacity_insufficient_history",
}

ASSIGNMENT_CAPACITY_DEFAULTS = {
    "assignment_capacity_lookback_days": 7,
    "assignment_capacity_observed_days": 5,
    "assignment_capacity_min": 150,
    "assignment_capacity_max": 200,
    "assignment_capacity_insufficient_history": "configured_min",
}

ASSIGNMENT_CAPACITY_MODES = {"configured_min"}


def validate_capacity_settings(
    *,
    lookback_days: int,
    observed_days: int,
    min_daily_capacity: int,
    max_daily_capacity: int,
    insufficient_history_mode: str,
) -> tuple[bool, str | None]:
    """Validate the complete capacity configuration, including min/max ordering."""
    if not 1 <= lookback_days <= 30:
        return False, "assignment_capacity_lookback_days must be between 1 and 30"
    if not 1 <= observed_days <= 30:
        return False, "assignment_capacity_observed_days must be between 1 and 30"
    if not 1 <= min_daily_capacity <= 5000:
        return False, "assignment_capacity_min must be between 1 and 5000"
    if not 1 <= max_daily_capacity <= 5000:
        return False, "assignment_capacity_max must be between 1 and 5000"
    if observed_days > lookback_days:
        return False, "assignment_capacity_observed_days cannot be greater than lookback_days"
    if min_daily_capacity > max_daily_capacity:
        return False, "assignment_capacity_min cannot be greater than assignment_capacity_max"
    if insufficient_history_mode not in ASSIGNMENT_CAPACITY_MODES:
        return False, "assignment_capacity_insufficient_history must be configured_min"
    return True, None

def validate_config_value(key: str, value: str) -> tuple[str | None, str | None]:
    """Returns (normalized_value, error_msg). 任一字段在前端都能改，必须独立校验。"""
    if key == "stale_days":
        try:
            n = int(value)
        except ValueError:
            return None, "stale_days must be an integer between 1 and 30"
        if not 1 <= n <= 30:
            return None, "stale_days must be an integer between 1 and 30"
        return str(n), None
    if key == "follow_up_window_minutes":
        try:
            n = int(value)
        except ValueError:
            return None, "follow_up_window_minutes must be an integer between 1 and 60"
        if not 1 <= n <= 60:
            return None, "follow_up_window_minutes must be an integer between 1 and 60"
        return str(n), None
    if key == "score_daily_call_target":
        score_target_msg = (
            "score_daily_call_target must be an integer between 1 and "
            f"{SCORE_DAILY_CALL_TARGET_MAX}"
        )
        try:
            n = int(value)
        except ValueError:
            return None, score_target_msg
        if not 1 <= n <= SCORE_DAILY_CALL_TARGET_MAX:
            return None, score_target_msg
        return str(n), None
    if key in {
        "assignment_capacity_lookback_days",
        "assignment_capacity_observed_days",
    }:
        try:
            n = int(value)
        except ValueError:
            return None, f"{key} must be an integer between 1 and 30"
        if not 1 <= n <= 30:
            return None, f"{key} must be an integer between 1 and 30"
        return str(n), None
    if key in {"assignment_capacity_min", "assignment_capacity_max"}:
        try:
            n = int(value)
        except ValueError:
            return None, f"{key} must be an integer between 1 and 5000"
        if not 1 <= n <= 5000:
            return None, f"{key} must be an integer between 1 and 5000"
        return str(n), None
    if key == "assignment_capacity_insufficient_history":
        if value not in ASSIGNMENT_CAPACITY_MODES:
            return None, "assignment_capacity_insufficient_history must be configured_min"
        return value, None
    if key == "pushplus_token":
        if len(value) > 64:
            return None, "pushplus_token too long"
        return value, None
    return value, None


def mask_config_value(key: str, value: str) -> str:
    if key == "pushplus_token" and len(value) > 4:
        return "****" + value[-4:]
    return value
