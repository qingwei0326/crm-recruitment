import { useState } from 'react';
import { buildEnrollmentReport } from '../../utils/reportText';
import ProgramPicker from './ProgramPicker';
import useReportCopy from './useReportCopy';

const fieldCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100';
const labelCls = 'space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 block';

// The agent's 报名 report: it waits for an admin to confirm, and the 喜报 for the
// group can be copied at the same time.
export default function EnrollmentReportForm({ student, submitting = false, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    program: student.program || '',
    region: student.region || '',
    notes: '',
  });
  const { agentName, copyReport } = useReportCopy();
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const canSubmit = Boolean(form.program.trim()) && !submitting;

  const submit = (event, { copy = false } = {}) => {
    event.preventDefault();
    if (!canSubmit) return;
    // Copy first, inside the click: browsers refuse to copy after a network wait.
    if (copy) {
      copyReport(buildEnrollmentReport({
        studentName: student.name,
        program: form.program.trim(),
        agentName,
        region: form.region.trim(),
      }));
    }
    onSubmit?.({
      student_id: student.id,
      enrolled_program: form.program.trim(),
      region: form.region.trim(),
      notes: form.notes.trim(),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-xs text-gray-700 dark:text-gray-200">学生姓名：{student.name || '-'}</div>
      <ProgramPicker
        label="报读专业"
        value={form.program}
        onChange={(value) => update('program', value)}
      />
      <label className={labelCls}>
        <span>地区</span>
        <input
          aria-label="地区"
          value={form.region}
          onChange={(event) => update('region', event.target.value)}
          className={fieldCls}
          placeholder="如：华安仙都"
        />
      </label>
      <label className={labelCls}>
        <span>备注</span>
        <textarea
          aria-label="报名备注"
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
          className={fieldCls}
          rows={2}
          placeholder="如：已交定金、哪天到校缴费"
        />
      </label>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        上报后由管理员确认登记，确认前学生状态不变。
      </p>
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
          className="px-3 py-2 rounded-lg border border-green-600 text-green-700 dark:text-green-300 text-sm disabled:opacity-60"
        >
          只上报
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={(event) => submit(event, { copy: true })}
          className="px-3 py-2 rounded-lg bg-green-600 text-white text-sm disabled:opacity-60"
        >
          {submitting ? '提交中...' : '上报并复制喜报'}
        </button>
      </div>
    </form>
  );
}
