import { useState } from 'react';

const fieldCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100';
const readonlyCls = 'rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-200';

function valueOrNull(value) {
  return value ? `${value}:00` : null;
}

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function HomeVisitForm({ student, submitting = false, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    address: '',
    requested_visit_time: '',
    campus_visit_time: '',
    priority: '中',
    usual_score: '',
    parent_intent: '',
    student_situation: '',
    is_wechat_added: false,
    is_confirmed_with_guardian: false,
    notes: '',
  });

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    const campusInfo = [
      form.campus_visit_time ? `到校参观时间：${form.campus_visit_time}` : '',
      form.student_situation ? `情况：${form.student_situation}` : '',
      form.notes,
    ].filter(Boolean).join('\n');
    onSubmit?.({
      student_id: student.id,
      intent_program: student.program || '',
      exam_score: student.score ?? null,
      usual_score: numberOrNull(form.usual_score),
      parent_intent: form.parent_intent,
      student_situation: form.student_situation,
      is_wechat_added: form.is_wechat_added,
      is_confirmed_with_guardian: form.is_confirmed_with_guardian,
      requested_visit_time: valueOrNull(form.requested_visit_time),
      address: form.address,
      priority: form.priority,
      notes: campusInfo,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <section className="rounded-lg border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-900/20">
        <div className="mb-2 text-xs font-semibold text-blue-900 dark:text-blue-100">上报信息</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className={readonlyCls}>学生姓名：{student.name || '-'}</div>
          <div className={readonlyCls}>家长电话：{student.guardian_phone || student.guardian2_phone || '-'}</div>
          <div className={readonlyCls}>意向专业：{student.program || '-'}</div>
          <div className={readonlyCls}>中考分数：{student.score ?? '-'}</div>
        </div>
      </section>
      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">家访安排</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          <span>家访地址</span>
          <input
            aria-label="家访地址"
            value={form.address}
            onChange={(event) => update('address', event.target.value)}
            className={fieldCls}
            placeholder="详细地址"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          <span>期望家访时间</span>
          <input
            aria-label="期望家访时间"
            type="datetime-local"
            value={form.requested_visit_time}
            onChange={(event) => update('requested_visit_time', event.target.value)}
            className={fieldCls}
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          <span>到校参观时间</span>
          <input
            aria-label="到校参观时间"
            value={form.campus_visit_time}
            onChange={(event) => update('campus_visit_time', event.target.value)}
            className={fieldCls}
            placeholder="如：周六上午 / 成绩出来后"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          <span>优先级</span>
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
        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          <span>平时成绩</span>
          <input
            aria-label="平时成绩"
            type="number"
            value={form.usual_score}
            onChange={(event) => update('usual_score', event.target.value)}
            className={fieldCls}
          />
        </label>
      </div>
      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">沟通情况</div>
      <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 block">
        <span>家长意向说明</span>
        <textarea
          aria-label="家长意向说明"
          value={form.parent_intent}
          onChange={(event) => update('parent_intent', event.target.value)}
          className={fieldCls}
          rows={2}
        />
      </label>
      <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 block">
        <span>情况</span>
        <textarea
          aria-label="情况"
          value={form.student_situation}
          onChange={(event) => update('student_situation', event.target.value)}
          className={fieldCls}
          rows={2}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={form.is_wechat_added}
            onChange={(event) => update('is_wechat_added', event.target.checked)}
          />
          已加微信
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={form.is_confirmed_with_guardian}
            onChange={(event) => update('is_confirmed_with_guardian', event.target.checked)}
          />
          已和家长确认
        </label>
      </div>
      <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 block">
        <span>家访备注</span>
        <textarea
          aria-label="家访备注"
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
          className={fieldCls}
          rows={2}
        />
      </label>
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
          disabled={submitting}
          className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60"
        >
          {submitting ? '提交中...' : '提交家访申请'}
        </button>
      </div>
    </form>
  );
}
