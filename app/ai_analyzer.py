"""AI intent analysis - DeepSeek API engine + keyword fallback (UTF-8)"""

import json
import logging
import os
import re

import httpx

from app.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE

logger = logging.getLogger("ai_analyzer")

# Load keywords from external JSON config  [optimization: external config]
_keyword_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "keywords.json")
try:
    with open(_keyword_dir, encoding="utf-8") as _f:
        _KW = json.load(_f)
except FileNotFoundError as e:
    raise RuntimeError(
        f"AI 关键词文件缺失: {_keyword_dir}（应与 app/ai_analyzer.py 同目录的 keywords.json）"
    ) from e
except json.JSONDecodeError as e:
    raise RuntimeError(f"keywords.json 不是合法 JSON（{_keyword_dir}）: {e}") from e

_required_kw = ("A", "B", "C", "enroll", "abandon", "visit")
_missing = [k for k in _required_kw if k not in _KW]
if _missing:
    raise RuntimeError(f"keywords.json 缺少必需键: {', '.join(_missing)}（文件: {_keyword_dir}）")

A_KEYWORDS = _KW["A"]
B_KEYWORDS = _KW["B"]
C_KEYWORDS = _KW["C"]
ENROLL_KEYWORDS = _KW["enroll"]
ABANDON_KEYWORDS = _KW["abandon"]
VISIT_KEYWORDS = _KW["visit"]

MAX_TRANSCRIPT_LENGTH = 2000  # [optimization: input length limit]
API_TIMEOUT = 20
API_RETRIES = 2

# LLM JSON uses English "none"; DB / keyword path use Chinese "无" (IntentLevel.none)
_NONE_SENTINELS = frozenset({"", "none", "null", "unknown", "n/a", "无"})


def normalize_ai_intent(raw: object) -> str:
    """Map model output to canonical A/B/C/无 for storage and IntentLevel."""
    if raw is None:
        return "无"
    s = str(raw).strip()
    if s.lower() in _NONE_SENTINELS:
        return "无"
    if s in ("A", "B", "C"):
        return s
    logger.warning("Unknown ai_intent value %r, defaulting to 无", raw)
    return "无"


def _keyword_analyze(transcript: str) -> dict:
    """Keyword-based fallback analysis"""
    if not transcript or not transcript.strip():
        return {
            "ai_intent": "无",
            "ai_confidence": 0.0,
            "ai_summary": "transcript is empty",
            "ai_reasons": "",
        }

    text = transcript.strip()
    a_matches = [kw for kw in A_KEYWORDS if kw in text]
    b_matches = [kw for kw in B_KEYWORDS if kw in text]
    c_matches = [kw for kw in C_KEYWORDS if kw in text]
    enroll_matches = [kw for kw in ENROLL_KEYWORDS if kw in text]
    visit_matches = [kw for kw in VISIT_KEYWORDS if kw in text]
    abandon_matches = [kw for kw in ABANDON_KEYWORDS if kw in text]

    a_score = len(a_matches) * 3
    b_score = len(b_matches) * 1
    c_score = len(c_matches) * 3
    if enroll_matches:
        a_score += len(enroll_matches) * 5
    if abandon_matches:
        a_score = 0
        c_score += len(abandon_matches) * 4

    if a_score >= 9:
        intent, confidence_base = "A", 0.85
    elif a_score >= 4:
        intent, confidence_base = "A", 0.70
    elif a_score >= 2 or b_score >= 3:
        intent, confidence_base = "B", 0.70
    elif b_score >= 1:
        intent, confidence_base = "B", 0.55
    elif c_score >= 4:
        intent, confidence_base = "C", 0.80
    elif c_score >= 1:
        intent, confidence_base = "C", 0.60
    else:
        intent, confidence_base = "无", 0.40

    total_matches = len(set(a_matches + b_matches + c_matches))
    if total_matches >= 5:
        confidence_base += 0.10
    elif total_matches >= 3:
        confidence_base += 0.05
    confidence = min(round(confidence_base, 2), 0.99)

    summary_parts = []
    if enroll_matches:
        summary_parts.append(f"Detected enrollment intent: {', '.join(enroll_matches[:2])}")
    if visit_matches:
        summary_parts.append(f"Visit intent: {', '.join(visit_matches[:2])}")
    if a_matches:
        summary_parts.append(f"High-intent keywords: {', '.join(a_matches[:3])}")
    if abandon_matches:
        summary_parts.append(f"Chose other school: {', '.join(abandon_matches[:2])}")
    if total_matches == 0:
        summary_parts.append("No obvious intent keywords matched")
    ai_summary = "; ".join(summary_parts) if summary_parts else "No key info detected"

    reasons_parts = []
    if intent == "A":
        reasons_parts.append("Multiple high-intent keywords matched")
        if enroll_matches:
            reasons_parts.append("Clear enrollment intent expressed")
    elif intent == "B":
        reasons_parts.append("Moderate interest or wait-and-see attitude")
    elif intent == "C":
        reasons_parts.append("Low interest or no-demand signal")
    else:
        reasons_parts.append("No clear intent signal detected")
    ai_reasons = "; ".join(reasons_parts)

    return {
        "ai_intent": intent,
        "ai_confidence": confidence,
        "ai_summary": ai_summary,
        "ai_reasons": ai_reasons,
    }


async def _call_deepseek(prompt: str, api_key: str) -> dict | None:
    """Async DeepSeek API call via httpx"""
    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        resp = await client.post(
            f"{DEEPSEEK_BASE}/v1/chat/completions",
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "max_tokens": 300,
            },
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        body = resp.json()
    content = body["choices"][0]["message"]["content"].strip()

    if "```" in content:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", content)
        content = match.group(1) if match else content
    parsed = json.loads(content)
    return {
        "ai_intent": normalize_ai_intent(parsed.get("intent", "无")),
        "ai_confidence": min(float(parsed.get("confidence", 0.7)), 0.99),
        "ai_summary": parsed.get("summary", ""),
        "ai_reasons": parsed.get("reasons", ""),
    }


async def _deepseek_analyze(transcript: str, api_key: str | None = None) -> dict | None:
    """Call DeepSeek API with retry & timeout protection (async)"""
    import asyncio

    key = (api_key or DEEPSEEK_API_KEY or "").strip()
    if not key or not transcript or not transcript.strip():
        return None

    truncated = transcript[:MAX_TRANSCRIPT_LENGTH]

    prompt = (
        "You are an admissions call analysis assistant. Analyze the following "
        "agent-parent conversation transcript and determine the student/parent "
        "enrollment intent level.\n\n"
        "Levels:\n"
        "- A (High intent): clear enrollment intent, asks about registration process, "
        "requests reservation, confirms visit\n"
        "- B (Medium intent): some interest but still considering, needs family "
        "discussion, comparing schools\n"
        "- C (Low intent): clear rejection, already enrolled elsewhere, not interested\n\n"
        "Return ONLY valid JSON in this format (no extra text):\n"
        '{"intent":"A/B/C/无","confidence":0.0-1.0,'
        '"summary":"one-line summary","reasons":"reasoning"}\n\n'
        f"Transcript:\n{truncated}"
    )

    for attempt in range(API_RETRIES + 1):
        try:
            return await _call_deepseek(prompt, key)
        except httpx.HTTPError as e:
            logger.warning(f"DeepSeek API attempt {attempt + 1}/{API_RETRIES + 1} failed: {e}")
            if attempt < API_RETRIES:
                await asyncio.sleep(1 * (attempt + 1))
            else:
                logger.error("DeepSeek API all retries exhausted, falling back to keyword")
        except Exception as e:
            logger.warning(f"DeepSeek API error, falling back to keyword: {e}")
            return None
    return None


async def analyze_transcript(transcript: str, api_key: str | None = None) -> dict:
    """Analyze transcript: prefer DeepSeek API, fall back to keyword matching.

    api_key 优先用调用方传入（来自 SystemConfig）；为空则 fallback 到模块加载时
    读取的 DEEPSEEK_API_KEY env 变量。
    """
    result = await _deepseek_analyze(transcript, api_key)
    if result:
        result = {**result, "ai_intent": normalize_ai_intent(result.get("ai_intent"))}
        return result
    out = _keyword_analyze(transcript)
    return {**out, "ai_intent": normalize_ai_intent(out.get("ai_intent"))}


# Conversion prediction config  [optimization: weights externalized]

INTENT_WEIGHTS = {"A": 0.90, "B": 0.50, "C": 0.10, "无": 0.05}
# English keys for internal callers; Chinese values match StudentStage (DB / API).
STAGE_WEIGHTS = {
    "enrolled": 1.00,
    "visited": 0.85,
    "visit_scheduled": 0.70,
    "materials_sent": 0.50,
    "interested": 0.35,
    "initial_contact": 0.15,
    "已报名": 1.00,
    "已来访": 0.85,
    "预约参观": 0.70,
    "已送资料": 0.50,
    "有意向": 0.35,
    "初次联系": 0.15,
}


def predict_conversion(
    intent_level: str,
    stage: str,
    total_notes: int = 0,
    has_follow_up: bool = False,
    has_visit: bool = False,
    days_since_assign: int = 30,
) -> float:
    """Predict final enrollment probability (0.0 ~ 1.0)"""
    scores = []

    scores.append((INTENT_WEIGHTS.get(normalize_ai_intent(intent_level), 0.05), 0.40))

    # days_since_assign: reserved for future decay factor

    # Stage
    scores.append((STAGE_WEIGHTS.get(stage, 0.15), 0.30))

    # Interaction frequency (each note +0.02, max 5)
    notes_bonus = min(total_notes, 5) * 0.02
    scores.append((notes_bonus, 0.10))

    # Has follow-up reminder
    scores.append((0.12 if has_follow_up else 0.0, 0.10))

    # Has visit record
    scores.append((0.15 if has_visit else 0.0, 0.10))

    weighted = sum(score * weight for score, weight in scores)
    return round(max(0.0, min(1.0, weighted + 0.02)), 4)
