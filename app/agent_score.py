"""Read-only agent work scoring helpers for admin previews."""

from collections.abc import Mapping

COMPONENT_MAX = {
    "task_progress": 30.0,
    "call_activity": 25.0,
    "follow_up_timeliness": 20.0,
    "intent_output": 15.0,
    "data_completeness": 10.0,
}


def score_agent_work(
    metrics: Mapping[str, int | float],
    *,
    daily_call_target: int = 30,
) -> dict:
    """Build an explainable 100-point preview score from already aggregated metrics."""
    safe_call_target = max(int(daily_call_target or 1), 1)
    active_tasks = _as_int(metrics.get("active_tasks"))
    progress_pct = _as_float(metrics.get("progress_pct"))
    today_calls = _as_int(metrics.get("today_calls"))
    open_follow_ups = _as_int(metrics.get("open_follow_ups"))
    overdue_follow_ups = _as_int(metrics.get("overdue_follow_ups"))
    a_level_count = _as_int(metrics.get("a_level_count"))
    enrolled_count = _as_int(metrics.get("enrolled_count"))
    missing_phone_tasks = _as_int(metrics.get("missing_phone_tasks"))

    task_progress = _component("task_progress", progress_pct / 100 if active_tasks else 1)
    call_activity = _component("call_activity", today_calls / safe_call_target)
    if open_follow_ups:
        follow_up_timeliness = _component(
            "follow_up_timeliness",
            (open_follow_ups - overdue_follow_ups) / open_follow_ups,
        )
    else:
        follow_up_timeliness = COMPONENT_MAX["follow_up_timeliness"]

    intent_output = min(
        COMPONENT_MAX["intent_output"],
        round(a_level_count * 3 + enrolled_count * 5, 1),
    )
    if active_tasks:
        data_completeness = _component(
            "data_completeness",
            (active_tasks - missing_phone_tasks) / active_tasks,
        )
    else:
        data_completeness = COMPONENT_MAX["data_completeness"]

    components = {
        "task_progress": _component_payload(
            "任务推进",
            task_progress,
            COMPONENT_MAX["task_progress"],
            "active task progress",
        ),
        "call_activity": _component_payload(
            "今日通话",
            call_activity,
            COMPONENT_MAX["call_activity"],
            "daily dial volume",
        ),
        "follow_up_timeliness": _component_payload(
            "回访及时",
            follow_up_timeliness,
            COMPONENT_MAX["follow_up_timeliness"],
            "open follow-up timeliness",
        ),
        "intent_output": _component_payload(
            "有效产出",
            intent_output,
            COMPONENT_MAX["intent_output"],
            "A intent and enrollment",
        ),
        "data_completeness": _component_payload(
            "资料完整",
            data_completeness,
            COMPONENT_MAX["data_completeness"],
            "active task phone completeness",
        ),
    }
    total_score = round(sum(item["score"] for item in components.values()), 1)
    signals = _build_signals(metrics, safe_call_target)

    return {
        "score": total_score,
        "level": _level(total_score),
        "level_label": _level_label(total_score),
        "components": components,
        "signals": signals,
        "recommended_action": _recommended_action(metrics, safe_call_target),
    }


def _component(name: str, ratio: float) -> float:
    return round(max(0.0, min(1.0, ratio)) * COMPONENT_MAX[name], 1)


def _component_payload(label: str, score: float, max_score: float, basis: str) -> dict:
    return {
        "label": label,
        "score": round(score, 1),
        "max": max_score,
        "basis": basis,
    }


def _build_signals(
    metrics: Mapping[str, int | float],
    daily_call_target: int,
) -> list[dict]:
    signals: list[dict] = []
    active_tasks = _as_int(metrics.get("active_tasks"))
    overdue_follow_ups = _as_int(metrics.get("overdue_follow_ups"))
    missing_phone_tasks = _as_int(metrics.get("missing_phone_tasks"))
    today_calls = _as_int(metrics.get("today_calls"))
    progress_pct = _as_float(metrics.get("progress_pct"))
    contacted_count = _as_int(metrics.get("contacted_count"))
    a_level_count = _as_int(metrics.get("a_level_count"))

    if active_tasks == 0:
        signals.append(
            {
                "key": "no_active_tasks",
                "severity": "info",
                "label": "暂无活跃任务",
                "count": 0,
            }
        )
    if overdue_follow_ups > 0:
        signals.append(
            {
                "key": "overdue_follow_ups",
                "severity": "critical",
                "label": f"{overdue_follow_ups} 条逾期回访",
                "count": overdue_follow_ups,
            }
        )
    if missing_phone_tasks > 0:
        signals.append(
            {
                "key": "missing_phone_tasks",
                "severity": "warning",
                "label": f"{missing_phone_tasks} 条活跃任务缺少电话",
                "count": missing_phone_tasks,
            }
        )
    if today_calls < daily_call_target * 0.5:
        signals.append(
            {
                "key": "low_call_activity",
                "severity": "warning",
                "label": "今日通话低于目标 50%",
                "count": today_calls,
            }
        )
    if active_tasks >= 10 and progress_pct < 40:
        signals.append(
            {
                "key": "low_progress",
                "severity": "warning",
                "label": "任务推进率偏低",
                "count": active_tasks,
            }
        )
    if contacted_count >= 10 and a_level_count == 0:
        signals.append(
            {
                "key": "no_a_output",
                "severity": "info",
                "label": "已联系线索暂未产出 A 意向",
                "count": contacted_count,
            }
        )

    return signals[:5]


def _recommended_action(
    metrics: Mapping[str, int | float],
    daily_call_target: int,
) -> str:
    if _as_int(metrics.get("overdue_follow_ups")) > 0:
        return "先处理逾期回访，防止高意向线索流失"
    if _as_int(metrics.get("missing_phone_tasks")) > 0:
        return "补齐活跃任务的联系电话"
    if _as_int(metrics.get("active_tasks")) == 0:
        return "检查是否需要补充分配或回收复查"
    if _as_int(metrics.get("today_calls")) < daily_call_target:
        return "优先拨打未联系和新线索，补齐今日通话量"
    return "继续推进 A/B 意向线索到回访或到访"


def _level(score: float) -> str:
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 55:
        return "watch"
    return "risk"


def _level_label(score: float) -> str:
    return {
        "excellent": "优秀",
        "good": "正常",
        "watch": "关注",
        "risk": "风险",
    }[_level(score)]


def _as_int(value: int | float | None) -> int:
    return int(value or 0)


def _as_float(value: int | float | None) -> float:
    return float(value or 0)
