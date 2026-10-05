import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Phone,
  StickyNote,
} from 'lucide-react';
import { INTENT_BADGES, statusLabel } from '../../../labels';
import { STATUS_STYLE, getContactOptions } from '../agentWorkUtils';
import AssignedDaysBadge from '../shared/AssignedDaysBadge';
import StageProgress from '../shared/StageProgress';
import ExpandedRow from './ExpandedRow';

const COLUMNS = [
  { key: 'name', label: '学生', className: 'w-[18%]' },
  { key: 'school_name', label: '学校 / 地域', className: 'w-[22%]' },
  { key: 'stage', label: '推进阶段', className: 'w-[21%]' },
  { key: 'intent_level', label: '意向', className: 'w-[8%]' },
  { key: 'status', label: '联系状态', className: 'w-[15%]' },
];

export default function StudentTable({
  students,
  expandedId,
  onToggleExpand,
  sortConfig,
  onSort,
  onDial,
  onQuickStatus,
  onUpdateStage,
  onAddNote,
  onScoreChange,
  lockedStudentId,
  noteText,
  onNoteTextChange,
}) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const visibleIds = new Set(students.map((student) => student.id));
  const visibleSelectedCount = [...selectedIds].filter((id) => visibleIds.has(id)).length;
  const allSelected = students.length > 0 && visibleSelectedCount === students.length;

  const toggleSelectAll = () => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleSelect = (id) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-gray-50 px-3 py-2 scroll-thin dark:bg-gray-950/50">
      <table className="w-full min-w-[940px] table-fixed border-separate border-spacing-y-1 text-sm">
        <thead className="sticky top-0 z-20 text-left">
          <tr>
            <th className="w-11 bg-gray-50 px-3 py-2 dark:bg-gray-950">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                aria-label={allSelected ? '取消选择全部学生' : '选择全部学生'}
              />
            </th>
            {COLUMNS.map((column) => (
              <SortableHeader
                key={column.key}
                column={column}
                sortConfig={sortConfig}
                onSort={onSort}
              />
            ))}
            <th className="w-32 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:bg-gray-950 dark:text-gray-400">
              快捷操作
            </th>
          </tr>
        </thead>
        <tbody>
          {students.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-20 text-center text-xs font-medium text-gray-400 dark:text-gray-600">
                暂无符合当前条件的话务任务
              </td>
            </tr>
          ) : (
            students.map((student) => (
              <StudentRow
                key={student.id}
                student={student}
                isExpanded={expandedId === student.id}
                isSelected={selectedIds.has(student.id)}
                isLocked={lockedStudentId === student.id}
                onToggleExpand={() => onToggleExpand(student.id)}
                onSelect={() => toggleSelect(student.id)}
                onDial={(contactKey) => onDial(contactKey, student.id)}
                onQuickStatus={(status) => onQuickStatus(student.id, status)}
                onUpdateStage={(stage) => onUpdateStage(student.id, stage)}
                onAddNote={() => onAddNote(student.id)}
                onScoreChange={onScoreChange}
                noteText={expandedId === student.id ? noteText : ''}
                onNoteTextChange={onNoteTextChange}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({ column, sortConfig, onSort }) {
  const active = sortConfig.key === column.key;
  return (
    <th className={`${column.className} bg-gray-50 px-3 py-2 dark:bg-gray-950`}>
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-1 text-xs font-medium transition ${
          active
            ? 'text-blue-700 dark:text-blue-400'
            : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
        }`}
      >
        {column.label}
        {active && (
          sortConfig.direction === 'asc'
            ? <ChevronUp className="h-3 w-3" />
            : <ChevronDown className="h-3 w-3" />
        )}
      </button>
    </th>
  );
}

function StudentRow({
  student: student,
  isExpanded,
  isSelected,
  isLocked,
  onToggleExpand,
  onSelect,
  onDial,
  onQuickStatus,
  onUpdateStage,
  onAddNote,
  onScoreChange,
  noteText,
  onNoteTextChange,
}) {
  const contacts = getContactOptions(student);
  const cellTone = isExpanded
    ? 'border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/25'
    : 'border-gray-200 bg-white group-hover:border-blue-200 group-hover:bg-blue-50/30 dark:border-gray-800 dark:bg-gray-900 dark:group-hover:border-blue-900 dark:group-hover:bg-blue-950/15';

  return (
    <>
      <tr
        className="group cursor-pointer transition-colors"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
      >
        <td className={`rounded-l-lg border-y border-l px-3 py-2.5 ${cellTone}`} onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onSelect}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
            aria-label={`${isSelected ? '取消选择' : '选择'} ${student.name || '学生'}`}
          />
        </td>
        <td className={`border-y px-3 py-2.5 ${cellTone}`}>
          <div className="flex min-w-0 items-center gap-2">
            {isExpanded
              ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-blue-600" />
              : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />}
            <span className={`h-8 w-1 shrink-0 rounded-full ${intentRailClass(student.intent_level)}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold text-gray-900 dark:text-gray-100">{student.name}</span>
                {student.need_help && (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label="需要协助" />
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-2xs text-gray-400 dark:text-gray-500">
                <AssignedDaysBadge days={student.days_since_assigned} />
                {student.score != null && <span className="tabular-nums">{student.score} 分</span>}
              </div>
            </div>
          </div>
        </td>
        <td className={`border-y px-3 py-2.5 ${cellTone}`}>
          <div className="max-w-[220px] truncate font-medium text-gray-700 dark:text-gray-200" title={student.school_name || '未知学校'}>
            {student.school_name || '未知学校'}
          </div>
          <div className="mt-0.5 truncate text-2xs text-gray-400 dark:text-gray-500">{student.region || '地域未填写'}</div>
        </td>
        <td className={`border-y px-3 py-2.5 ${cellTone}`} onClick={(event) => event.stopPropagation()}>
          <StageProgress currentStage={student.stage} onStageClick={onUpdateStage} compact />
        </td>
        <td className={`border-y px-3 py-2.5 ${cellTone}`}>
          <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${INTENT_BADGES[student.intent_level] || INTENT_BADGES['无']}`}>
            {student.intent_level === '无' ? '未评级' : `${student.intent_level}级`}
          </span>
        </td>
        <td className={`border-y px-3 py-2.5 ${cellTone}`}>
          <div className="flex items-center gap-1.5">
            <span className={`inline-flex shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLE[student.status] || STATUS_STYLE['未联系']}`}>
              {statusLabel(student.status)}
            </span>
          </div>
          {student.status_detail && (
            <div className="mt-1 max-w-[160px] truncate text-2xs text-gray-500 dark:text-gray-400" title={student.status_detail}>
              {student.status_detail}
            </div>
          )}
        </td>
        <td className={`rounded-r-lg border-y border-r px-3 py-2.5 ${cellTone}`} onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            {contacts.length > 0 && (
              <IconButton
                onClick={() => onDial(contacts[0].key)}
                title={`拨打 ${contacts[0].name}`}
                label={`拨打 ${contacts[0].name}`}
                className="text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              >
                <Phone className="h-4 w-4" />
              </IconButton>
            )}
            <IconButton
              onClick={onAddNote}
              title="写备注"
              label={`给 ${student.name || '学生'} 写备注`}
              className="text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
            >
              <StickyNote className="h-4 w-4" />
            </IconButton>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} className="px-0 pb-1 pt-0">
            <ExpandedRow
              student={student}
              isLocked={isLocked}
              onDial={onDial}
              onQuickStatus={onQuickStatus}
              onUpdateStage={onUpdateStage}
              onAddNote={onAddNote}
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

function IconButton({ children, className, label, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-30 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function intentRailClass(level) {
  if (level === 'A') return 'bg-red-500';
  if (level === 'B') return 'bg-amber-500';
  if (level === 'C') return 'bg-blue-500';
  return 'bg-gray-300 dark:bg-gray-700';
}
