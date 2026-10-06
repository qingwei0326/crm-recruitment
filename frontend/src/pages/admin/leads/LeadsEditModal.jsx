import { X } from 'lucide-react';
import { inputCls } from '../leadsManageUtils';

const EDIT_FIELDS = [
  ['name', '姓名'],
  ['region', '地域'],
  ['score', '成绩'],
  ['guardian_name', '监护人姓名'],
  ['guardian_phone', '监护人电话'],
  ['guardian2_name', '监护人2姓名'],
  ['guardian2_phone', '监护人2电话'],
  ['school_name', '学校名称'],
];

export default function LeadsEditModal({ student, onClose, onChange, onSave }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-panel shadow-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">编辑学生信息</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          {EDIT_FIELDS.map(([key, label]) => (
            <div key={key}>
              <label className="block text-sm mb-1">{label}</label>
              <input
                aria-label={label}
                value={student[key] || ''}
                onChange={(e) => onChange(key, e.target.value)}
                className={inputCls}
                type={key === 'score' ? 'number' : 'text'}
              />
            </div>
          ))}
          <button type="button" onClick={onSave} className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm">保存</button>
        </div>
      </div>
    </div>
  );
}
