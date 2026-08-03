import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime

from cryptography.fernet import Fernet, InvalidToken

from app.config import SECRET_KEY

_CIPHER_PREFIX = "v1:"


class AssistantSecretError(ValueError):
    pass


def _fernet() -> Fernet:
    digest = hashlib.sha256(f"crm-assistant:{SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_assistant_secret(value: str) -> str:
    if not value:
        return ""
    token = _fernet().encrypt(value.encode()).decode()
    return f"{_CIPHER_PREFIX}{token}"


def decrypt_assistant_secret(value: str) -> str:
    if not value:
        return ""
    if not value.startswith(_CIPHER_PREFIX):
        raise AssistantSecretError("AI 助手密钥格式无效，请重新保存")
    try:
        return _fernet().decrypt(value.removeprefix(_CIPHER_PREFIX).encode()).decode()
    except (InvalidToken, UnicodeDecodeError) as exc:
        raise AssistantSecretError("AI 助手密钥无法解密，请重新保存") from exc


def sign_assistant_approval(
    *,
    tool_call_id: str,
    operator_id: int,
    preview_hash: str,
    expires_at: datetime,
) -> str:
    aware_expiry = expires_at.replace(tzinfo=UTC) if expires_at.tzinfo is None else expires_at
    payload = {
        "v": 1,
        "tool_call_id": tool_call_id,
        "operator_id": operator_id,
        "preview_hash": preview_hash,
        "expires_at": int(aware_expiry.timestamp()),
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    ).rstrip(b"=")
    signature = hmac.new(SECRET_KEY.encode(), encoded, hashlib.sha256).hexdigest()
    return f"{encoded.decode()}.{signature}"


def verify_assistant_approval(
    token: str,
    *,
    tool_call_id: str,
    operator_id: int,
    preview_hash: str,
    now: datetime,
) -> bool:
    try:
        encoded_text, signature = token.split(".", 1)
        encoded = encoded_text.encode()
        expected = hmac.new(SECRET_KEY.encode(), encoded, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return False
        payload = json.loads(base64.urlsafe_b64decode(encoded + b"=" * (-len(encoded) % 4)))
        aware_now = now.replace(tzinfo=UTC) if now.tzinfo is None else now
        return (
            payload.get("v") == 1
            and payload.get("tool_call_id") == tool_call_id
            and payload.get("operator_id") == operator_id
            and payload.get("preview_hash") == preview_hash
            and int(payload.get("expires_at") or 0) >= int(aware_now.timestamp())
        )
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return False
