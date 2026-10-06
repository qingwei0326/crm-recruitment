import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Square,
  Trash2,
} from 'lucide-react';
import { stageLabel, statusLabel } from '../../../labels';
import { EDITABLE_STATUS_OPTS, EDITABLE_STAGE_OPTS } from './leadOptions';
import NextActionSummary from './NextActionSummary';

/**
 * 桌面端线索表格行。展开面板由 children 传入，保持行与面板的渲染顺序。
 */
export default function LeadsTableRow({
  lead,
  isExpanded,
  isSelected,
  permissions,
  actions,
  children,
}) {
  const l = lead;
  const isEnrolled = l.status === '已报名' || l.stage === '已报名';
  return (
    <>
      <tr
        onClick={() => actions.toggleExpand(l.id)}
        className={`cursor-pointer transition-colors ${
          isExpanded
            ? 'bg-blue-50 dark:bg-blue-900/20'
            : 'hover:bg-gray-50 dark:hover:bg-gray-700'
        } ${l.status === '无效' ? 'opacity-60' : ''} ${
          l.need_help ? 'bg-red-50/50 dark:bg-red-900/5' : ''
        }`}
      >
        <td className="pl-1.5 pr-0 py-2.5 text-center">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-blue-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </td>
        <td className="px-1 py-2.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => actions.toggleSelect(l.id)}
            className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={`${isSelected ? '取消选择' : '选择'} ${l.name || '学生'}`}
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-blue-600" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>
        </td>
        <td className="px-2 py-2.5 font-medium">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-900 dark:text-gray-100">{l.name}</span>
            {l.need_help && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
            <Link
              to={`/admin/leads/${l.id}`}
              onClick={(e) => e.stopPropagation()}
              title="查看详情"
              aria-label={`查看 ${l.name || '学生'} 详情`}
              className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </td>
        <td className="px-2 py-2.5 hidden md:table-cell">
          {l.school_name ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-900/30 text-teal-700">
              {l.school_name}
            </span>
          ) : (
            '-'
          )}
        </td>
        <td className="px-2 py-2.5 hidden lg:table-cell">
          {isEnrolled ? (
            <span className="inline-flex min-h-9 items-center rounded-lg bg-green-100 px-2 py-1.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
              已报名
            </span>
          ) : (
            <select
              aria-label={`设置 ${l.name || '学生'} 跟进阶段`}
              value={l.stage}
              onChange={(e) => {
                e.stopPropagation();
                actions.quickStage(l.id, e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
              disabled={!permissions.canEditStudent}
              className="min-h-9 text-xs px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 border-0 cursor-pointer"
            >
              {EDITABLE_STAGE_OPTS.map((st) => (
                <option key={st} value={st}>{stageLabel(st)}</option>
              ))}
            </select>
          )}
        </td>
        <td className="px-2 py-2.5">
          <div className="flex flex-col items-start gap-1">
            {isEnrolled ? (
              <span className="inline-flex min-h-9 items-center rounded-lg bg-green-100 px-2 py-1.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                已报名
              </span>
            ) : (
              <select
                aria-label={`设置 ${l.name || '学生'} 状态`}
                value={l.status}
                onChange={(e) => {
                  e.stopPropagation();
                  actions.quickStatus(l.id, e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                disabled={!permissions.canEditStudent}
                className={`min-h-9 text-xs px-2 py-1.5 rounded-lg border-0 cursor-pointer ${
                  l.status === '未联系'
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-600'
                    : l.status === '无效'
                    ? 'bg-gray-200 text-gray-400'
                    : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700'
                }`}
              >
                {EDITABLE_STATUS_OPTS.map((st) => (
                  <option key={st} value={st}>{statusLabel(st)}</option>
                ))}
              </select>
            )}
            {l.status_detail && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300">
                {l.status === '无效' ? `原因：${l.status_detail}` : l.status_detail}
              </span>
            )}
          </div>
        </td>
        <td className="px-2 py-2.5 hidden sm:table-cell">
          {l.intent_level !== '无' ? (
            <span
              className={`inline-block w-6 h-6 rounded-full text-xs font-bold text-center leading-6 ${
                l.intent_level === 'A'
                  ? 'bg-red-100 text-red-600'
                  : l.intent_level === 'B'
                  ? 'bg-amber-100 text-amber-600'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {l.intent_level}
            </span>
          ) : (
            '-'
          )}
        </td>
        <td className="px-2 py-2.5 hidden md:table-cell max-w-48">
          <NextActionSummary action={l.next_action} />
        </td>
        <td className="px-1 py-2.5 w-4">
          {permissions.canDeleteStudent && (
            <button
              type="button"
              aria-label={`删除 ${l.name || '学生'}`}
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                actions.remove(l);
              }}
              className="inline-flex min-w-8 min-h-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </td>
      </tr>
      {children}
    </>
  );
}
