import { useEffect } from 'react';
import { X } from 'lucide-react';
import { inputCls, createStudentFields } from './agentWorkUtils';

export default function StudentCreateModal({ student, setStudent, error, onClose, onSubmit }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-create-modal-title"
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-panel border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900 animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 mb-4 flex items-center justify-between bg-white pb-2 dark:bg-slate-900">
          <h3 id="student-create-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">手动添加学生</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭添加学生弹窗"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {createStudentFields.map((field) => (
            <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <label className="mb-1 block text-sm text-slate-700 dark:text-slate-300">
                {field.label} {field.required && '*'}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  value={student[field.key] || ''}
                  onChange={(e) => setStudent({ ...student, [field.key]: e.target.value })}
                  className={`${inputCls} h-20 resize-none`}
                  rows={3}
                />
              ) : (
                <input
                  value={student[field.key] || ''}
                  onChange={(e) => setStudent({ ...student, [field.key]: e.target.value })}
                  className={inputCls}
                  type={field.type || 'text'}
                />
              )}
            </div>
          ))}
          <div className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
            添加后会自动分配到当前话务员，话务员不能删除学生。
          </div>
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500 dark:bg-red-900/30 sm:col-span-2">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={onSubmit}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 sm:col-span-2"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
