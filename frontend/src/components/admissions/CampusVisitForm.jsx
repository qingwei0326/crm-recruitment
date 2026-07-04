import { useState } from 'react';

const fieldCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100';

function dateTimeOrNull(value) {
  return value ? `${value}:00` : null;
}

function intOrDefault(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function CampusVisitForm({ student, source = '电话外呼', submitting = false, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    appointment_at: '',
    needs_pickup: false,
    visitor_count: 1,
    current_concerns: '',
    notes: '',
  });

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    onSubmit?.({
      student_id: student.id,
      source,
      intent_program: student.program || '',
      appointment_at: dateTimeOrNull(form.appointment_at),
      needs_pickup: form.needs_pickup,
      visitor_count: intOrDefault(form.visitor_count, 1),
      current_concerns: form.current_concerns,
      notes: form.notes,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          <span>预约到校时间</span>
          <input
            aria-label="预约到校时间"
            type="datetime-local"
            value={form.appointment_at}
            onChange={(event) => update('appointment_at', event.target.value)}
            className={fieldCls}
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
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
      <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        <input
          type="checkbox"
          checked={form.needs_pickup}
          onChange={(event) => update('needs_pickup', event.target.checked)}
        />
        需要接送
      </label>
      <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 block">
        <span>当前顾虑</span>
        <textarea
          aria-label="当前顾虑"
          value={form.current_concerns}
          onChange={(event) => update('current_concerns', event.target.value)}
          className={fieldCls}
          rows={2}
        />
      </label>
      <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 block">
        <span>到校备注</span>
        <textarea
          aria-label="到校备注"
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
          {submitting ? '提交中...' : '提交到校预约'}
        </button>
      </div>
    </form>
  );
}
