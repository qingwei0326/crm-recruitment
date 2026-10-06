"""Governance review tokens and stored reviews (no FastAPI dependencies).

A review token binds a signal key to a snapshot of the affected entities, so a
review only counts while those entities are unchanged.
"""

import base64
import binascii
import hashlib
import hmac
import json
import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import SECRET_KEY
from app.models import OperationLog, User
from app.utils import make_operation_log, utcnow

GOVERNANCE_REVIEW_PREFIX = "governance-review:"


GOVERNANCE_REVIEW_TTL_DAYS = 7


GOVERNANCE_REVIEW_TOKEN_MAX_AGE_SECONDS = 15 * 60


class GovernanceRequestError(Exception):
    """A rejected governance request; routers answer it with ``Response.error(code=1)``."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _review_snapshot(entity_keys: list[str]) -> tuple[str, int]:
    normalized = sorted({str(key).strip() for key in entity_keys if str(key).strip()})
    digest = hashlib.sha256("\n".join(normalized).encode("utf-8")).hexdigest()
    return digest, len(normalized)


def _sign_governance_review_token(key: str, snapshot_hash: str, count: int) -> str:
    payload = {
        "v": 1,
        "key": key,
        "snapshot_hash": snapshot_hash,
        "count": max(int(count), 0),
        "issued_at": int(utcnow().replace(tzinfo=UTC).timestamp()),
    }
    raw = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode()
    encoded = base64.urlsafe_b64encode(raw).rstrip(b"=")
    signature = hmac.new(SECRET_KEY.encode(), encoded, hashlib.sha256).hexdigest().encode()
    return f"{encoded.decode()}.{signature.decode()}"


def _verify_governance_review_token(token: str, expected_key: str) -> dict | None:
    try:
        encoded_text, signature = token.split(".", 1)
        encoded = encoded_text.encode()
        expected_signature = hmac.new(
            SECRET_KEY.encode(), encoded, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_signature):
            return None
        padding = b"=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(encoded + padding).decode())
        issued_at = int(payload.get("issued_at") or 0)
        now_ts = int(utcnow().replace(tzinfo=UTC).timestamp())
        if payload.get("v") != 1 or payload.get("key") != expected_key:
            return None
        if issued_at > now_ts + 60 or now_ts - issued_at > GOVERNANCE_REVIEW_TOKEN_MAX_AGE_SECONDS:
            return None
        snapshot_hash = str(payload.get("snapshot_hash") or "")
        count = max(int(payload.get("count") or 0), 0)
        if len(snapshot_hash) != 64:
            return None
        return {"snapshot_hash": snapshot_hash, "count": count}
    except (TypeError, ValueError, KeyError, json.JSONDecodeError, binascii.Error):
        return None


async def _latest_governance_reviews(db: AsyncSession, cutoff: datetime) -> dict[str, dict]:
    rows = (
        await db.execute(
            select(
                OperationLog.batch_id,
                OperationLog.old_status,
                OperationLog.note_content,
                OperationLog.created_at,
            )
            .where(
                OperationLog.action == "治理复核",
                OperationLog.batch_id.like(f"{GOVERNANCE_REVIEW_PREFIX}%"),
                OperationLog.created_at >= cutoff,
            )
            .order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
        )
    ).all()
    reviews = {}
    for batch_id, old_status, note_content, reviewed_at in rows:
        batch_id = batch_id or ""
        if not batch_id.startswith(GOVERNANCE_REVIEW_PREFIX):
            continue
        key = batch_id[len(GOVERNANCE_REVIEW_PREFIX) :].strip()
        if not key or key in reviews:
            continue
        try:
            reviewed_count = int(old_status or 0)
        except (TypeError, ValueError):
            reviewed_count = 0
        snapshot_hash = ""
        snapshot_count = reviewed_count
        try:
            snapshot = json.loads(note_content or "{}")
            if snapshot.get("v") == 1:
                snapshot_hash = str(snapshot.get("snapshot_hash") or "")
                snapshot_count = max(int(snapshot.get("count") or 0), 0)
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
        reviews[key] = {
            "count": max(reviewed_count, 0),
            "snapshot_hash": snapshot_hash,
            "snapshot_count": snapshot_count,
            "reviewed_at": reviewed_at,
        }
    return reviews


def _apply_governance_review(item: dict, reviews: dict[str, dict], key: str) -> dict:
    public_item = {name: value for name, value in item.items() if name != "_review_entities"}
    snapshot_hash, current_count = _review_snapshot(item.get("_review_entities") or [])
    review_token = _sign_governance_review_token(key, snapshot_hash, current_count)
    review = reviews.get(key)
    if not review:
        legacy_key = item.get("key") or item.get("type")
        if legacy_key and legacy_key != key:
            review = reviews.get(legacy_key)
    if not review:
        return {
            **public_item,
            "count": current_count,
            "reviewed": False,
            "reviewed_count": 0,
            "current_count": current_count,
            "review_token": review_token,
        }

    reviewed_count = max(int(review.get("snapshot_count") or review.get("count") or 0), 0)
    reviewed_snapshot_hash = str(review.get("snapshot_hash") or "")
    reviewed_at = review.get("reviewed_at")
    data = {
        **public_item,
        "count": current_count,
        "reviewed": False,
        "reviewed_count": reviewed_count,
        "current_count": current_count,
        "reviewed_at": reviewed_at.isoformat() if reviewed_at else "",
        "review_token": review_token,
    }
    if current_count <= 0:
        return data
    if reviewed_snapshot_hash and hmac.compare_digest(snapshot_hash, reviewed_snapshot_hash):
        return {
            **data,
            "count": 0,
            "severity": "low",
            "reviewed": True,
            "detail": f"已确认复核本批 {reviewed_count} 项；异常对象变化后会重新提醒。",
        }
    if reviewed_snapshot_hash:
        data["detail"] = (
            f"{public_item.get('detail', '')} 异常对象已发生变化，"
            f"当前 {current_count} 项需重新复核。"
        )
    elif reviewed_count:
        data["detail"] = (
            f"{public_item.get('detail', '')} 旧复核记录没有对象快照，"
            f"当前 {current_count} 项需重新复核。"
        )
    return data


async def acknowledge_governance_review(
    db: AsyncSession,
    current_user: User,
    *,
    key: str,
    title: str,
    detail: str,
    review_token: str,
) -> dict:
    key = key.strip()
    if not key:
        raise GovernanceRequestError("缺少复核项")
    safe_key = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", key)[:40]
    snapshot = _verify_governance_review_token(review_token, safe_key)
    if not snapshot:
        raise GovernanceRequestError("复核凭证已失效，请刷新页面后重试")
    title = (title or key).strip()
    detail = (detail or "").strip()
    count = snapshot["count"]
    snapshot_content = json.dumps(
        {
            "v": 1,
            "snapshot_hash": snapshot["snapshot_hash"],
            "count": count,
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="治理复核",
            content=f"确认复核 {title}：{detail}" if detail else f"确认复核 {title}",
            old_status=str(count),
            new_status="已复核",
            note_content=snapshot_content,
            batch_id=f"{GOVERNANCE_REVIEW_PREFIX}{safe_key}",
        )
    )
    await db.commit()
    return {"reviewed": True, "key": safe_key, "count": count}
