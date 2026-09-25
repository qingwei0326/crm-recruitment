import { X } from 'lucide-react';
import { INTENT_OPTS, STATUS_OPTS, createStudentFields, inputCls } from '../leadsManageUtils';
import { EDITABLE_STAGE_OPTS } from './leadOptions';
import { stageLabel, statusLabel } from '../../../labels';

export default function LeadsCreateModal({
  form,
  agents,
  error,
  onClose,
  onFieldChange,
  onSubmit,
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-white dark:bg-gray-800 z-10 pb-2">
          <h3 className="text-lg font-semibold">新建学生</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {createStudentFields.map((field) => (
            <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <label className="block text-sm mb-1">
                {field.label} {field.required && '*'}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  aria-label={field.label}
                  value={form[field.key] || ''}
                  onChange={(e) => onFieldChange(field.key, e.target.value)}
                  className={`${inputCls} h-20 resize-none`}
                  rows={3}
                />
              ) : (
                <input
                  aria-label={field.label}
                  value={form[field.key] || ''}
                  onChange={(e) => onFieldChange(field.key, e.target.value)}
                  className={inputCls}
                  type={field.type || 'text'}
                />
              )}
            </div>
          ))}
          <div>
            <label className="block text-sm mb-1">状态</label>
            <select aria-label="新建学生状态" value={form.status} onChange={(e) => onFieldChange('status', e.target.value)} className={inputCls}>
              {STATUS_OPTS.filter((o) => o !== '已报名').map((o) => <option key={o} value={o}>{o ? statusLabel(o) : '默认'}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">意向等级</label>
            <select aria-label="新建学生意向等级" value={form.intent_level} onChange={(e) => onFieldChange('intent_level', e.target.value)} className={inputCls}>
              {INTENT_OPTS.map((o) => <option key={o} value={o}>{o || '默认'}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">跟进阶段</label>
            <select aria-label="新建学生跟进阶段" value={form.stage} onChange={(e) => onFieldChange('stage', e.target.value)} className={inputCls}>
              <option value="">默认</option>
              {EDITABLE_STAGE_OPTS.map((o) => <option key={o} value={o}>{stageLabel(o)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">分配话务员</label>
            <select aria-label="新建学生分配话务员" value={form.assigned_to} onChange={(e) => onFieldChange('assigned_to', e.target.value)} className={inputCls}>
              <option value="">不分配</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.need_help}
              onChange={(e) => onFieldChange('need_help', e.target.checked)}
              className="rounded border-gray-300"
            />
            标记为需要协助
          </label>
          <div className="sm:col-span-2">
            {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">{error}</div>}
          </div>
          <div className="sm:col-span-2">
            <button type="button" onClick={onSubmit} className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm">创建</button>
          </div>
        </div>
      </div>
    </div>
  );
}
