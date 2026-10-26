import { useState } from 'react';
import {
  buildVisitReport,
  formatVisitTime,
  initialReportValues,
} from '../../utils/reportText';
import ProgramPicker from './ProgramPicker';
import useReportCopy from './useReportCopy';

const fieldCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100';
const labelCls = 'space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 block';

function dateTimeOrNull(value) {
  return value ? `${value}:00` : null;
}

function intOrDefault(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// "周六上午" and/or an exact pick, as one line for the group report.
function visitTimeText(at, note) {
  return [formatVisitTime(at), note.trim()].filter(Boolean).join(' ');
}

function VisitTimeField({ label, note, at, onNote, onAt }) {
  return (
    <div className="space-y-1">
      <label className={labelCls}>
        <span>{label}</span>
        <input
          aria-label={label}
          value={note}
          onChange={(event) => onNote(event.target.value)}
          className={fieldCls}
          placeholder="如：周六上午 / 成绩出来后 / 明天再约"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="shrink-0">具体时间</span>
        <input
          aria-label={`${label}（具体时间）`}
          type="datetime-local"
          value={at}
          onChange={(event) => onAt(event.target.value)}
          className={fieldCls}
        />
      </label>
    </div>
  );
}

// One form for the work-group visit report: fill the home visit time, the campus
// visit time, or both, and the matching tasks are created together.
export default function VisitReportForm({ student, submitting = false, onSubmit, onCancel }) {
  const initial = initialReportValues(student);
  const [form, setForm] = useState({
    phone: initial.phone,
    program: initial.program,
    score: initial.score === '' ? '' : String(initial.score),
    campusNote: '',
    campusAt: '',
    homeNote: '',
    homeAt: '',
    address: '',
    situation: '',
    priority: '中',
    usual_score: '',
    parent_intent: '',
    is_wechat_added: false,
    is_confirmed_with_guardian: false,
    needs_pickup: false,
    visitor_count: 1,
    notes: '',
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const { agentName, copyReport } = useReportCopy();
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const hasHome = Boolean(form.homeAt || form.homeNote.trim());
  const hasCampus = Boolean(form.campusAt || form.campusNote.trim());
  const canSubmit = (hasHome || hasCampus) && !submitting;

  const reportText = () => buildVisitReport({
    agentName,
    studentName: student.name,
    phone: form.phone,
    program: form.program,
    score: form.score,
    campusTime: visitTimeText(form.campusAt, form.campusNote),
    situation: form.situation,
    homeTime: visitTimeText(form.homeAt, form.homeNote),
    address: form.address,
  });

  const submit = (event, { copy = false } = {}) => {
    event.preventDefault();
    if (!canSubmit) return;
    // Copy first, inside the click: browsers refuse to copy after a network wait.
    if (copy) copyReport(reportText());
    onSubmit?.({
      student_id: student.id,
      intent_program: form.program.trim(),
      exam_score_text: form.score.trim(),
      home_visit_at: dateTimeOrNull(form.homeAt),
      home_visit_note: form.homeNote.trim(),
      campus_visit_at: dateTimeOrNull(form.campusAt),
      campus_visit_note: form.campusNote.trim(),
      address: form.address,
      situation: form.situation,
      priority: form.priority,
      usual_score: numberOrNull(form.usual_score),
      parent_intent: form.parent_intent,
      is_wechat_added: form.is_wechat_added,
      is_confirmed_with_guardian: form.is_confirmed_with_guardian,
      needs_pickup: form.needs_pickup,
      visitor_count: intOrDefault(form.visitor_count, 1),
      notes: form.notes,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-xs text-gray-700 dark:text-gray-200">学生姓名：{student.name || '-'}</div>
      <label className={labelCls}>
        <span>家长电话</span>
        <input
          aria-label="家长电话"
          inputMode="tel"
          value={form.phone}
          onChange={(event) => update('phone', event.target.value)}
          className={fieldCls}
          placeholder="没有就留空"
        />
      </label>
      <ProgramPicker
        label="意向专业"
        value={form.program}
        onChange={(value) => update('program', value)}
      />
      <label className={labelCls}>
        <span>中考分数</span>
        <input
          aria-label="中考分数"
          value={form.score}
          onChange={(event) => update('score', event.target.value)}
          className={fieldCls}
          placeholder="如：380 / 200-300分 / 没考"
        />
      </label>
      <VisitTimeField
        label="到校参观时间"
        note={form.campusNote}
        at={form.campusAt}
        onNote={(value) => update('campusNote', value)}
        onAt={(value) => update('campusAt', value)}
      />
      <VisitTimeField
        label="家访时间"
        note={form.homeNote}
        at={form.homeAt}
        onNote={(value) => update('homeNote', value)}
        onAt={(value) => update('homeAt', value)}
      />
      <p className="text-xs text-gray-500 dark:text-gray-400">
        到校、家访至少填一个；选了具体时间的才会按时提醒。
      </p>
      <label className={labelCls}>
        <span>地址</span>
        <input
          aria-label="地址"
          value={form.address}
          onChange={(event) => update('address', event.target.value)}
          className={fieldCls}
          placeholder="家访地址"
        />
      </label>
      <label className={labelCls}>
        <span>情况</span>
        <textarea
          aria-label="情况"
          value={form.situation}
          onChange={(event) => update('situation', event.target.value)}
          className={fieldCls}
          rows={2}
        />
      </label>

      <button
        type="button"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((open) => !open)}
        className="text-xs font-medium text-teal-700 dark:text-teal-300"
      >
        {moreOpen ? '收起更多' : '更多（优先级、平时成绩、来校人数…）'}
      </button>
      {moreOpen && (
        <div className="space-y-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>
              <span>家访优先级</span>
              <select
                aria-label="家访优先级"
                value={form.priority}
                onChange={(event) => update('priority', event.target.value)}
                className={fieldCls}
              >
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </label>
            <label className={labelCls}>
              <span>平时成绩</span>
              <input
                aria-label="平时成绩"
                type="number"
                value={form.usual_score}
                onChange={(event) => update('usual_score', event.target.value)}
                className={fieldCls}
              />
            </label>
            <label className={labelCls}>
              <span>来校人数</span>
              <input
                aria-label="来校人数"
                type="number"
                min="1"
                max="20"
                value={form.visitor_count}
                onChange={(event) => update('visitor_count', event.target.value)}
                className={fieldCls}
              />
            </label>
          </div>
          <label className={labelCls}>
            <span>家长意向说明</span>
            <textarea
              aria-label="家长意向说明"
              value={form.parent_intent}
              onChange={(event) => update('parent_intent', event.target.value)}
              className={fieldCls}
              rows={2}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            {[
              ['is_wechat_added', '已加微信'],
              ['is_confirmed_with_guardian', '已和家长确认'],
              ['needs_pickup', '到校需要接送'],
            ].map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) => update(key, event.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          <label className={labelCls}>
            <span>备注</span>
            <textarea
              aria-label="备注"
              value={form.notes}
              onChange={(event) => update('notes', event.target.value)}
              className={fieldCls}
              rows={2}
            />
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-3 py-2 rounded-lg border border-teal-600 text-teal-700 dark:text-teal-300 text-sm disabled:opacity-60"
        >
          只提交
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={(event) => submit(event, { copy: true })}
          className="px-3 py-2 rounded-lg bg-teal-600 text-white text-sm disabled:opacity-60"
        >
          {submitting ? '提交中...' : '提交并复制到群'}
        </button>
      </div>
    </form>
  );
}
