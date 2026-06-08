import { X } from 'lucide-react';
import { inputCls, createStudentFields } from './agentWorkUtils';

export default function StudentCreateModal({ student, setStudent, error, onClose, onSubmit }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-white dark:bg-gray-800 z-10 pb-2">
          <h3 className="text-lg font-semibold">手动添加学生</h3>
          <button onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {createStudentFields.map((field) => (
            <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <label className="block text-sm mb-1">
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
          <div className="sm:col-span-2 text-xs text-gray-500 dark:text-gray-400">
            添加后会自动分配到当前话务员，话务员不能删除学生。
          </div>
          {error && (
            <div className="sm:col-span-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
          <button onClick={onSubmit} className="sm:col-span-2 w-full py-2.5 bg-green-600 text-white rounded-lg text-sm">
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
