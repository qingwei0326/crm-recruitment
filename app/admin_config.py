import re

SCORE_DAILY_CALL_TARGET_MAX = 1000

ALLOWED_CONFIG_KEYS = {
    "pushplus_token",
    "stale_days",
    "dial_window_start",
    "dial_window_end",
    "dial_max_per_24h",
    "deepseek_api_key",
    "ai_provider",
    "mimo_api_key",
    "mimo_base",
    "mimo_model",
    "ai_custom_api_key",
    "ai_custom_base",
    "ai_custom_model",
    "follow_up_window_minutes",
    "score_daily_call_target",
}

AI_PROVIDERS = {"deepseek", "mimo", "custom"}
AI_BASE_KEYS = {"mimo_base", "ai_custom_base"}
AI_MODEL_KEYS = {"mimo_model", "ai_custom_model"}
AI_GENERIC_KEY_KEYS = {"mimo_api_key", "ai_custom_api_key"}

HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


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
    if key == "dial_max_per_24h":
        try:
            n = int(value)
        except ValueError:
            return None, "dial_max_per_24h must be an integer between 1 and 20"
        if not 1 <= n <= 20:
            return None, "dial_max_per_24h must be an integer between 1 and 20"
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
    if key in ("dial_window_start", "dial_window_end"):
        if not HHMM_RE.match(value):
            return None, f"{key} must be HH:MM (24h)"
        return value, None
    if key == "pushplus_token":
        if len(value) > 64:
            return None, "pushplus_token too long"
        return value, None
    if key == "deepseek_api_key":
        if value and len(value) > 128:
            return None, "deepseek_api_key too long"
        # 接受空串（用于清除）；非空必须形如 sk-xxx 避免误填
        if value and not value.startswith("sk-"):
            return None, "deepseek_api_key 必须以 sk- 开头"
        return value, None
    if key == "ai_provider":
        if value and value not in AI_PROVIDERS:
            return None, "ai_provider 必须是 deepseek / mimo / custom 之一"
        return (value or "deepseek"), None
    if key in AI_BASE_KEYS:
        if value and not (value.startswith("http://") or value.startswith("https://")):
            return None, f"{key} 必须是 http(s):// 开头的接口地址"
        if len(value) > 256:
            return None, f"{key} too long"
        return value, None
    if key in AI_MODEL_KEYS:
        if len(value) > 64:
            return None, f"{key} too long"
        return value, None
    if key in AI_GENERIC_KEY_KEYS:
        # MiMo / 自定义 的 key 不强制 sk- 前缀，只做长度上限
        if len(value) > 256:
            return None, f"{key} too long"
        return value, None
    return value, None


def mask_config_value(key: str, value: str) -> str:
    if (
        key in ("pushplus_token", "deepseek_api_key", "mimo_api_key", "ai_custom_api_key")
        and len(value) > 4
    ):
        return "****" + value[-4:]
    return value
