import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Home as HomeIcon,
  Loader2,
  MapPin,
  Square,
} from 'lucide-react';
import { stageLabel, statusLabel } from '../../../labels';
import {
  CAMPUS_ACTION_STAGES,
  HOME_ACTION_STAGES,
  inputCls,
} from '../leadsManageUtils';
import { EDITABLE_STATUS_OPTS, EDITABLE_STAGE_OPTS } from './leadOptions';
import NextActionSummary from './NextActionSummary';

/**
 * 移动端线索卡片：概览信息 + 展开后的快捷跟进操作。
 */
export default function LeadsMobileCard({
  lead,
  isExpanded,
  isSelected,
  permissions,
  noteValue,
  homeSubmitting,
  campusSubmitting,
  actions,
}) {
  const l = lead;
  return (
    <div
      key={l.id}
      className={`rounded-lg border bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${
        l.need_help ? 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10' : ''
      } ${l.status === '无效' ? 'opacity-75' : ''}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => actions.toggleSelect(l.id)}
          className="mt-0.5 inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg bg-gray-50 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
          aria-label={`${isSelected ? '取消选择' : '选择'} ${l.name || '学生'}`}
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-blue-600" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>

        <button
          type="button"
          onClick={() => actions.toggleExpand(l.id)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={isExpanded}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
              {l.name || `学生 #${l.id}`}
            </span>
            {l.need_help && <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />}
            {isExpanded ? (
              <ChevronDown className="ml-auto w-4 h-4 shrink-0 text-blue-500" />
            ) : (
              <ChevronRight className="ml-auto w-4 h-4 shrink-0 text-gray-400" />
            )}
          </div>
          <div className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
            {l.school_name || '未知学校'} · {l.region || '未知地区'}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                l.status === '已报名'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : l.status === '无效'
                  ? 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
              }`}
            >
              {statusLabel(l.status)}
            </span>
            {l.status_detail && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-gray-700 dark:text-gray-300">
                {l.status_detail}
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {stageLabel(l.stage)}
            </span>
            {l.intent_level && l.intent_level !== '无' && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {l.intent_level}级
              </span>
            )}
          </div>
          <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-gray-900/60">
            <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">下一步</div>
            <NextActionSummary action={l.next_action} showEmpty />
          </div>
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          to={`/admin/leads/${l.id}`}
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-50 px-2 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
        >
          详情
        </Link>
        {permissions.canEditStudent && (
          <button
            type="button"
            onClick={() => actions.openEdit(l)}
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-gray-100 px-2 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-200"
          >
            编辑
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-2">
            {l.status === '已报名' || l.stage === '已报名' ? (
              <div className="col-span-2 flex min-h-10 items-center rounded-lg bg-green-50 px-3 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:text-green-300">
                已报名
              </div>
            ) : (
              <>
                <select
                  aria-label={`设置 ${l.name || '学生'} 状态`}
                  value={l.status}
                  onChange={(e) => actions.quickStatus(l.id, e.target.value)}
                  disabled={!permissions.canEditStudent}
                  className={`${inputCls} text-sm`}
                >
                  {EDITABLE_STATUS_OPTS.map((st) => (
                    <option key={st} value={st}>{statusLabel(st)}</option>
                  ))}
                </select>
                <select
                  aria-label={`设置 ${l.name || '学生'} 跟进阶段`}
                  value={l.stage}
                  onChange={(e) => actions.quickStage(l.id, e.target.value)}
                  disabled={!permissions.canEditStudent}
                  className={`${inputCls} text-sm`}
                >
                  {EDITABLE_STAGE_OPTS.map((st) => (
                    <option key={st} value={st}>{stageLabel(st)}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              aria-label={`给 ${l.name || '学生'} 写备注`}
              value={noteValue || ''}
              onChange={(e) => actions.onNoteChange(l.id, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && actions.addNote(l.id)}
              placeholder="写备注..."
              className={`min-w-0 flex-1 ${inputCls}`}
            />
            <button
              type="button"
              onClick={() => actions.addNote(l.id)}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-600 px-3 text-sm text-white"
            >
              提交
            </button>
          </div>
          {(permissions.canManageHomeVisits || permissions.canManageCampusVisits) && (
            <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-900/50 dark:bg-blue-900/10">
              <div className="mb-2">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                  招生任务
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  生成后进入对应管理页继续处理
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {permissions.canManageHomeVisits && HOME_ACTION_STAGES.has(l.stage) && (
                  <button
                    type="button"
                    onClick={() => actions.createHomeVisit(l)}
                    disabled={homeSubmitting === l.id}
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white disabled:opacity-60"
                  >
                    {homeSubmitting === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HomeIcon className="w-3.5 h-3.5" />}
                    生成家访任务
                  </button>
                )}
                {permissions.canManageCampusVisits && CAMPUS_ACTION_STAGES.has(l.stage) && (
                  <button
                    type="button"
                    onClick={() => actions.createCampusVisit(l)}
                    disabled={campusSubmitting === l.id}
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-green-600 px-3 text-xs font-medium text-white disabled:opacity-60"
                  >
                    {campusSubmitting === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                    生成到校任务
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => actions.toggleNeedHelp(l.id)}
              className={`rounded-lg px-3 py-2 text-sm ${
                l.need_help
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {l.need_help ? '取消协助' : '需要协助'}
            </button>
            {permissions.canDeleteStudent && (
              <button
                type="button"
                aria-label={`删除 ${l.name || '学生'}`}
                onClick={() => actions.remove(l)}
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
              >
                删除
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
