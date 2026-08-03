from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant_models import AssistantConfig
from app.assistant_security import decrypt_assistant_secret, encrypt_assistant_secret

DEFAULT_ASSISTANT_BASE_URL = "https://api.openai.com/v1"
ASSISTANT_PROTOCOL = "openai_chat_completions"
_BLOCKED_HOSTS = {"metadata.google.internal"}


class AssistantConfigError(ValueError):
    pass


@dataclass(frozen=True)
class AssistantRuntimeConfig:
    enabled: bool
    base_url: str
    endpoint: str
    model: str
    api_key: str


def normalize_assistant_base_url(value: str) -> str:
    raw = (value or "").strip().rstrip("/")
    if not raw:
        return DEFAULT_ASSISTANT_BASE_URL
    if len(raw) > 512:
        raise AssistantConfigError("Base URL 不能超过 512 个字符")
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise AssistantConfigError("Base URL 必须是有效的 http(s) 地址")
    if parsed.username or parsed.password:
        raise AssistantConfigError("Base URL 不能包含用户名或密码")
    if parsed.query or parsed.fragment:
        raise AssistantConfigError("Base URL 不能包含查询参数或片段")
    hostname = parsed.hostname.lower()
    if hostname in _BLOCKED_HOSTS:
        raise AssistantConfigError("Base URL 指向受保护的元数据地址")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address and (address.is_link_local or address.is_multicast or address.is_unspecified):
        raise AssistantConfigError("Base URL 指向不允许的网络地址")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def assistant_chat_endpoint(base_url: str) -> str:
    normalized = normalize_assistant_base_url(base_url)
    if normalized.endswith("/chat/completions"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/chat/completions"
    return f"{normalized}/v1/chat/completions"


def normalize_assistant_model(value: str) -> str:
    model = (value or "").strip()
    if len(model) > 128:
        raise AssistantConfigError("模型名称不能超过 128 个字符")
    return model


async def get_assistant_config(db: AsyncSession) -> AssistantConfig:
    config = await db.get(AssistantConfig, 1)
    if config is None:
        config = AssistantConfig(
            id=1,
            enabled=False,
            base_url=DEFAULT_ASSISTANT_BASE_URL,
            model="",
            api_key_ciphertext="",
            api_key_last4="",
        )
    return config


def assistant_config_payload(config: AssistantConfig) -> dict[str, object]:
    base_url = normalize_assistant_base_url(config.base_url)
    return {
        "enabled": bool(config.enabled),
        "base_url": base_url,
        "endpoint": assistant_chat_endpoint(base_url),
        "model": config.model or "",
        "api_key_configured": bool(config.api_key_ciphertext),
        "api_key_last4": config.api_key_last4 or "",
        "protocol": ASSISTANT_PROTOCOL,
    }


def runtime_assistant_config(config: AssistantConfig) -> AssistantRuntimeConfig:
    base_url = normalize_assistant_base_url(config.base_url)
    model = normalize_assistant_model(config.model)
    api_key = decrypt_assistant_secret(config.api_key_ciphertext)
    if not model:
        raise AssistantConfigError("请先设置 AI 助手模型")
    if not api_key:
        raise AssistantConfigError("请先设置 AI 助手 API Key")
    return AssistantRuntimeConfig(
        enabled=bool(config.enabled),
        base_url=base_url,
        endpoint=assistant_chat_endpoint(base_url),
        model=model,
        api_key=api_key,
    )


def apply_assistant_config_update(
    config: AssistantConfig,
    *,
    enabled: bool,
    base_url: str,
    model: str,
    api_key: str | None,
    clear_api_key: bool,
    operator_id: int,
) -> AssistantConfig:
    normalized_base = normalize_assistant_base_url(base_url)
    normalized_model = normalize_assistant_model(model)
    if api_key is not None and clear_api_key:
        raise AssistantConfigError("不能同时设置并清除 API Key")
    if api_key is not None:
        normalized_key = api_key.strip()
        if not normalized_key:
            raise AssistantConfigError("API Key 不能为空；如需清除请使用清除选项")
        if len(normalized_key) > 512:
            raise AssistantConfigError("API Key 不能超过 512 个字符")
        config.api_key_ciphertext = encrypt_assistant_secret(normalized_key)
        config.api_key_last4 = normalized_key[-4:]
    elif clear_api_key:
        config.api_key_ciphertext = ""
        config.api_key_last4 = ""

    if enabled and (not normalized_model or not config.api_key_ciphertext):
        raise AssistantConfigError("启用助手前必须设置 Model 和 API Key")

    config.enabled = enabled
    config.base_url = normalized_base
    config.model = normalized_model
    config.updated_by = operator_id
    return config
