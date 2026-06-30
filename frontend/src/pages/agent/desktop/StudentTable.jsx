import { useState } from 'react';
import { ChevronUp, ChevronDown, Phone, StickyNote, Sparkles, AlertTriangle } from 'lucide-react';
import { INTENT_BADGES, statusLabel } from '../../../labels';
import { STATUS_STYLE, getContactOptions } from '../agentWorkUtils';
import AssignedDaysBadge from '../shared/AssignedDaysBadge';
import StageProgress from '../shared/StageProgress';
import ExpandedRow from './ExpandedRow';

const COLUMNS = [
  { key: 'name', label: '姓名', sortable: true, className: 'w-[16%]' },
  { key: 'school_name', label: '学校', sortable: true, className: 'w-[24%]' },
  { key: 'stage', label: '阶段', sortable: true, className: 'w-[18%]' },
  { key: 'intent_level', label: '意向', sortable: true, className: 'w-[8%]' },
  { key: 'status', label: '状态', sortable: true, className: 'w-[14%]' },
];

export default function StudentTable({
  students, expandedId, onToggleExpand,
  sortConfig, onSort,
  onDial, onQuickStatus, onUpdateStage, onAddNote, onOpenAi, onScoreChange,
  dialCheckByStudent, lockedStudentId, noteText, onNoteTextChange,
}) {
  const [selectedIds, setSelectedIds] = useState(new Set());

  const toggleSelectAll = () => {
    if (selectedIds.size === students.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(students.map((s) => s.id)));
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const SortIcon = ({ colKey }) => {
    if (sortConfig.key !== colKey) return null;
    return sortConfig.direction === 'asc'
      ? <ChevronUp className="w-3 h-3 inline" />
      : <ChevronDown className="w-3 h-3 inline" />;
  };

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
          <tr>
            <th className="w-10 px-3 py-2">
              <input
                type="checkbox"
                checked={selectedIds.size === students.length && students.length > 0}
                onChange={toggleSelectAll}
                className="rounded"
                aria-label={
                  selectedIds.size === students.length && students.length > 0
                    ? '取消选择全部学生'
                    : '选择全部学生'
                }
              />
            </th>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={`${col.className || ''} px-3 py-2 text-left text-xs font-medium text-gray-500 ${col.sortable ? 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none' : ''}`}
                onClick={() => col.sortable && onSort(col.key)}
              >
                {col.label} <SortIcon colKey={col.key} />
              </th>
            ))}
            <th className="w-24 px-3 py-2 text-xs font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-gray-700/50">
          {students.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center py-12 text-gray-400">
                暂无数据
              </td>
            </tr>
          ) : (
            students.map((s) => (
              <StudentRow
                key={s.id}
                student={s}
                isExpanded={expandedId === s.id}
                isSelected={selectedIds.has(s.id)}
                dialCheck={dialCheckByStudent[s.id]}
                isLocked={lockedStudentId === s.id}
                onToggleExpand={() => onToggleExpand(s.id)}
                onSelect={() => toggleSelect(s.id)}
                onDial={(key) => onDial(key, s.id)}
                onQuickStatus={(status) => onQuickStatus(s.id, status)}
                onUpdateStage={(stage) => onUpdateStage(s.id, stage)}
                onAddNote={() => onAddNote(s.id)}
                onOpenAi={() => onOpenAi(s)}
                onScoreChange={onScoreChange}
                noteText={expandedId === s.id ? noteText : ''}
                onNoteTextChange={onNoteTextChange}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function StudentRow({
  student: s, isExpanded, isSelected, isLocked,
  onToggleExpand, onSelect, onDial, onQuickStatus, onUpdateStage,
  onAddNote, onOpenAi, onScoreChange, noteText, onNoteTextChange,
}) {
  const contacts = getContactOptions(s);

  return (
    <>
      <tr
        className={`hover:bg-blue-50/50 dark:hover:bg-blue-900/10 cursor-pointer transition-colors ${
          isExpanded ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
        }`}
        onClick={onToggleExpand}
      >
        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onSelect}
            className="rounded"
            aria-label={`${isSelected ? '取消选择' : '选择'} ${s.name || '学生'}`}
          />
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-gray-100">{s.name}</span>
            {s.need_help && (
              <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
            )}
            <AssignedDaysBadge days={s.days_since_assigned} />
          </div>
        </td>
        <td className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[120px] truncate">
          {s.school_name || '未知学校'}
        </td>
        <td className="px-3 py-2">
          <StageProgress currentStage={s.stage} onStageClick={(stg) => onUpdateStage(stg)} compact />
        </td>
        <td className="px-3 py-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${INTENT_BADGES[s.intent_level] || INTENT_BADGES['无']}`}>
            {s.intent_level === '无' ? '无' : `${s.intent_level}级`}
          </span>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-col items-start gap-1">
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[s.status] || ''}`}>
              {statusLabel(s.status)}
            </span>
            {s.status_detail && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300">
                {s.status_detail}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            {contacts.length > 0 && (
              <button
                onClick={() => onDial(contacts[0].key)}
                className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600"
                title={`拨打 ${contacts[0].name}`}
                aria-label={`拨打 ${contacts[0].name}`}
              >
                <Phone className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onAddNote}
              className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-600"
              title="写备注"
              aria-label={`给 ${s.name || '学生'} 写备注`}
            >
              <StickyNote className="w-4 h-4" />
            </button>
            <button
              onClick={onOpenAi}
              disabled={isLocked}
              className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 text-purple-600 disabled:opacity-30"
              title="AI分析"
              aria-label={`分析 ${s.name || '学生'}`}
            >
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <ExpandedRow
              student={s}
              isLocked={isLocked}
              onDial={onDial}
              onQuickStatus={onQuickStatus}
              onUpdateStage={onUpdateStage}
              onAddNote={onAddNote}
              onOpenAi={onOpenAi}
              onScoreChange={onScoreChange}
              noteText={noteText}
              onNoteTextChange={onNoteTextChange}
            />
          </td>
        </tr>
      )}
    </>
  );
}
