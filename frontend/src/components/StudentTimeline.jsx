import { memo, useMemo } from 'react';
import {
  Calendar,
  GitBranch,
  GraduationCap,
  Home,
  MapPin,
  Phone,
  StickyNote,
  UserCheck,
} from 'lucide-react';
import TimelineItem from './TimelineItem';
import { formatDuration } from '../utils';

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function callDuration(call) {
  const seconds = firstValue(call.duration_seconds, call.duration);
  return ` · ${formatDuration(seconds)}`;
}

export function buildStudentTimeline({
  student,
  calls = [],
  notes = [],
  followUps = [],
  visits = [],
  intentTimeline = [],
  admissionsTimeline = [],
} = {}) {
  const items = [];

  if (student?.assigned_at) {
    items.push({
      kind: 'assignment',
      ts: student.assigned_at,
      data: student,
    });
  }

  calls.forEach((call) => {
    items.push({
      kind: 'call',
      ts: firstValue(call.created_at, call.call_time),
      data: call,
    });
  });

  notes.forEach((note) => {
    items.push({
      kind: 'note',
      ts: note.created_at,
      data: note,
    });
  });

  followUps.forEach((followUp) => {
    items.push({
      kind: 'follow_up',
      ts: firstValue(followUp.created_at, followUp.follow_up_date),
      data: followUp,
    });
  });

  visits.forEach((visit) => {
    items.push({
      kind: 'visit',
      ts: firstValue(visit.created_at, visit.scheduled_date, visit.visit_date),
      data: visit,
    });
  });

  intentTimeline.forEach((intent) => {
    items.push({
      kind: 'intent',
      ts: firstValue(intent.created_at, intent.at, intent.date),
      data: intent,
    });
  });

  admissionsTimeline.forEach((event) => {
    items.push({
      kind: 'admission',
      ts: firstValue(event.occurred_at, event.created_at),
      data: event,
    });
  });

  return items.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
}

function renderItem(item) {
  const d = item.data;
  if (item.kind === 'assignment') {
    return (
      <TimelineItem
        type="分配"
        icon={UserCheck}
        color="green"
        title="分配给话务员"
        content="线索进入当前话务员任务池"
        agentName={d.agent_name || d.assigned_agent_name}
        timestamp={d.assigned_at}
      />
    );
  }

  if (item.kind === 'call') {
    return (
      <TimelineItem
        type="通话"
        icon={Phone}
        color="blue"
        title={`通话${callDuration(d)}`}
        content={firstValue(d.ai_summary, d.content, d.notes, d.ai_reasons)}
        agentName={d.agent_name}
        timestamp={firstValue(d.created_at, d.call_time)}
      />
    );
  }

  if (item.kind === 'note') {
    return (
      <TimelineItem
        type="备注"
        icon={StickyNote}
        color={d.source === 'ai' ? 'purple' : 'gray'}
        title="备注"
        content={d.content}
        agentName={d.agent_name}
        timestamp={d.created_at}
        source={d.source}
      />
    );
  }

  if (item.kind === 'follow_up') {
    return (
      <TimelineItem
        type="回访"
        icon={Calendar}
        color="amber"
        title={`回访计划 · ${d.follow_up_date || ''}`}
        content={firstValue(d.notes, d.note, d.content)}
        agentName={d.agent_name}
        timestamp={d.created_at}
      />
    );
  }

  if (item.kind === 'visit') {
    return (
      <TimelineItem
        type="到访"
        icon={MapPin}
        color="teal"
        title={`${d.visit_type || '到访'} · ${d.status || '待确认'} · ${
          firstValue(d.scheduled_date, d.visit_date) || ''
        }`}
        content={firstValue(d.notes, d.note, d.content)}
        agentName={d.agent_name}
        timestamp={d.created_at}
      />
    );
  }

  if (item.kind === 'intent') {
    const level = d.intent_level || d.level || '无';
    const title = d.old_intent
      ? `意向变化 · ${d.old_intent} → ${level}`
      : `意向判断 · ${level}`;
    const confidence = d.confidence != null
      ? `置信度 ${Math.round(Number(d.confidence) * 100)}%`
      : '';
    return (
      <TimelineItem
        type="意向"
        icon={GitBranch}
        color={d.source === 'ai' ? 'purple' : 'amber'}
        title={title}
        content={confidence}
        agentName={d.agent_name || d.operator_name}
        timestamp={firstValue(d.created_at, d.at, d.date)}
        source={d.source}
      />
    );
  }

  if (item.kind === 'admission') {
    const icon = d.type === 'home_visit' ? Home : d.type === 'enrollment' ? GraduationCap : MapPin;
    const color = d.type === 'home_visit' ? 'blue' : d.type === 'enrollment' ? 'green' : 'teal';
    const title = `${d.title || '招生推进'} · ${d.status || ''}`.trim();
    return (
      <TimelineItem
        type="招生"
        icon={icon}
        color={color}
        title={title}
        content={firstValue(d.summary, d.result)}
        agentName={d.operator_name}
        timestamp={firstValue(d.occurred_at, d.created_at)}
      />
    );
  }

  return null;
}

function actionFor(item, renderNoteActions, renderFollowUpActions, renderVisitActions) {
  if (item.kind === 'note') return renderNoteActions?.(item.data);
  if (item.kind === 'follow_up') return renderFollowUpActions?.(item.data);
  if (item.kind === 'visit') return renderVisitActions?.(item.data);
  return null;
}

function testIdFor(item) {
  if (item.kind === 'follow_up') return `follow-up-${item.data.id}`;
  if (item.kind === 'visit') return `visit-${item.data.id}`;
  if (item.kind === 'admission') return `admission-${item.data.type}-${item.data.id}`;
  if (item.kind === 'note') return `note-${item.data.id}`;
  return undefined;
}

export default memo(function StudentTimeline({
  student,
  calls = [],
  notes = [],
  followUps = [],
  visits = [],
  intentTimeline = [],
  admissionsTimeline = [],
  limit,
  emptyText = '暂无记录',
  className = 'space-y-4',
  renderNoteActions,
  renderFollowUpActions,
  renderVisitActions,
}) {
  const items = useMemo(() => {
    const timeline = buildStudentTimeline({
      student,
      calls,
      notes,
      followUps,
      visits,
      intentTimeline,
      admissionsTimeline,
    });
    return limit ? timeline.slice(0, limit) : timeline;
  }, [student, calls, notes, followUps, visits, intentTimeline, admissionsTimeline, limit]);

  if (items.length === 0) {
    return <div className="py-10 text-center text-sm text-gray-400">{emptyText}</div>;
  }

  return (
    <div className={className}>
      {items.map((item, index) => {
        const actions = actionFor(item, renderNoteActions, renderFollowUpActions, renderVisitActions);
        const key = `${item.kind}-${item.data?.id || item.ts || index}`;
        return (
          <div key={key} data-testid={testIdFor(item)} className="relative">
            {renderItem(item)}
            {actions}
          </div>
        );
      })}
    </div>
  );
});
