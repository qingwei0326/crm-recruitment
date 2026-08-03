import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  PhoneCall,
} from 'lucide-react';
import DashboardPanelError from './DashboardPanelError';

const severityTone = {
  high: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
  medium: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
  low: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const actionTone = {
  red: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

function SectionHeading({ icon: Icon, title, meta }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-900 dark:text-gray-100">
        <Icon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        {title}
      </h3>
      {meta && <span className="text-[10px] text-gray-400">{meta}</span>}
    </div>
  );
}

function DailyOps({ dailyOps, loading, error, savingKey, canReview, onMark, onRetry }) {
  const summary = dailyOps?.summary || {};
  const activeItems = (dailyOps?.items || []).filter(
    (item) => item.count > 0 && !item.is_closed,
  );

  return (
    <section className="border-b border-gray-200 px-4 py-4 dark:border-gray-800">
      <SectionHeading icon={CheckCircle2} title="今日运营闭环" meta="记录不改变业务状态" />
      <div className="mt-3 grid grid-cols-3 divide-x divide-gray-200 rounded-lg bg-gray-50 py-2 text-center dark:divide-gray-700 dark:bg-gray-800/70">
        <div>
          <div className="text-sm font-bold tabular-nums text-gray-950 dark:text-white">{loading ? '-' : error ? '--' : summary.total_items || 0}</div>
          <div className="text-[10px] text-gray-400">今日事项</div>
        </div>
        <div>
          <div className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{loading ? '-' : error ? '--' : summary.closed_items || 0}</div>
          <div className="text-[10px] text-gray-400">已闭环</div>
        </div>
        <div>
          <div className="text-sm font-bold tabular-nums text-red-600 dark:text-red-400">{loading ? '-' : error ? '--' : summary.high_pending_items || 0}</div>
          <div className="text-[10px] text-gray-400">高风险</div>
        </div>
      </div>

      {loading && !error ? (
        <div className="py-6 text-center text-xs text-gray-400">加载运营闭环...</div>
      ) : error ? (
        <div className="mt-3">
          <DashboardPanelError title="运营闭环数据" onRetry={onRetry} retrying={loading} compact />
        </div>
      ) : activeItems.length === 0 ? (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          <div className="font-medium">今日运营闭环暂无待处理事项</div>
          <div className="mt-1 text-[10px] opacity-80">可以继续检查待分配池和风险队列。</div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {activeItems.map((item) => (
            <div key={item.key} className={`rounded-lg border p-3 ${severityTone[item.severity] || severityTone.low}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">{item.title}</div>
                  <div className="mt-1 text-[10px] leading-4 opacity-80">{item.detail}</div>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums">{item.count}</span>
              </div>
              <div className="mt-2 flex items-center gap-1 text-[10px] opacity-75">
                <Clock3 className="h-3 w-3" />
                {item.status}
                {item.reviewed_by && <span className="truncate"> · {item.reviewed_by}</span>}
              </div>
              {item.owners?.length > 0 && (
                <div className="mt-2 divide-y divide-current/10 border-y border-current/10 text-[10px]">
                  {item.owners.slice(0, 3).map((owner) => (
                    <Link
                      key={`${item.key}-${owner.agent_id ?? 'none'}`}
                      to={owner.to || item.to || '/admin/work-center'}
                      className="flex items-center justify-between gap-2 py-1.5 hover:underline"
                    >
                      <span className="truncate">{owner.agent_name}</span>
                      <span className="shrink-0">
                        {owner.count}项{owner.max_age_days > 0 ? ` · ${owner.max_age_days}天` : ''}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Link
                  to={item.to || '/admin/work-center'}
                  className="inline-flex h-7 items-center gap-1 rounded bg-white/70 px-2 text-[10px] font-medium hover:bg-white dark:bg-black/15 dark:hover:bg-black/25"
                >
                  查看 <ExternalLink className="h-3 w-3" />
                </Link>
                {canReview && !item.is_closed && ['已处理', '暂缓', '明日继续跟进', '无需处理'].map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={savingKey === `${item.key}:${status}`}
                    onClick={() => onMark(item, status)}
                    className={`h-7 rounded px-2 text-[10px] font-medium disabled:opacity-50 ${
                      status === '已处理'
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white/70 hover:bg-white dark:bg-black/15 dark:hover:bg-black/25'
                    }`}
                  >
                    {savingKey === `${item.key}:${status}` ? '记录中...' : status === '已处理' ? '确认处理' : status === '明日继续跟进' ? '明日继续' : status}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RiskQueue({ items, loading, error, onRetry }) {
  return (
    <section className="border-b border-gray-200 px-4 py-4 dark:border-gray-800">
      <SectionHeading
        icon={AlertTriangle}
        title="今日待办"
        meta={error ? '数据不完整' : items.length ? `${items.length} 类风险` : '无风险'}
      />
      {loading && !error ? (
        <div className="py-5 text-center text-xs text-gray-400">正在汇总风险...</div>
      ) : (
        <>
          {error && (
            <div className="mt-3">
              <DashboardPanelError title="待办风险数据" onRetry={onRetry} retrying={loading} compact />
            </div>
          )}
          {!error && items.length === 0 && (
            <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <div className="font-medium">今日暂无待处理风险项</div>
              <div className="mt-1 text-[10px] opacity-80">可继续查看下方关键指标和报表趋势。</div>
            </div>
          )}
          {items.length > 0 && (
            <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {items.map((item) => {
            const content = (
              <>
                <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-bold ${actionTone[item.tone] || actionTone.gray}`}>
                  {item.value}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-gray-800 dark:text-gray-100">{item.title}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-gray-400">{item.detail}</span>
                </span>
                {item.to && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />}
              </>
            );
            return item.to ? (
              <Link key={item.key} to={item.to} className="flex items-center gap-2.5 py-2.5 hover:text-blue-600">
                {content}
              </Link>
            ) : (
              <div key={item.key} className="flex items-center gap-2.5 py-2.5">{content}</div>
            );
          })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function OperationalOverview({
  enrollmentData,
  visitSummary,
  quality,
  loading,
  errors = {},
  onRetry,
  canViewLeadsManage,
  canViewReportCenter,
}) {
  const recordedCalls = quality?.calls?.today?.recorded_calls ?? 0;
  const totalVisits =
    (visitSummary?.by_type?.['来校参观'] || 0) + (visitSummary?.by_type?.['家访'] || 0);

  return (
    <section className="px-4 py-4">
      <SectionHeading icon={PhoneCall} title="经营概览" meta="实时口径" />
      {(errors.quality || errors.enrollment || errors.visits) && (
        <div className="mt-3">
          <DashboardPanelError title="经营概览数据" onRetry={onRetry} retrying={loading} compact />
        </div>
      )}
      <dl className="mt-3 grid grid-cols-3 divide-x divide-gray-200 rounded-lg bg-gray-50 py-2.5 text-center dark:divide-gray-700 dark:bg-gray-800/70">
        <div>
          <dd className="text-sm font-bold tabular-nums text-gray-950 dark:text-white">{loading ? '-' : errors.quality ? '--' : recordedCalls}</dd>
          <dt className="mt-0.5 text-[10px] text-gray-400">有效通话</dt>
        </div>
        <div>
          <dd className="text-sm font-bold tabular-nums text-gray-950 dark:text-white">{loading ? '-' : errors.enrollment ? '--' : enrollmentData?.total || 0}</dd>
          <dt className="mt-0.5 text-[10px] text-gray-400">报名总数</dt>
        </div>
        <div>
          <dd className="text-sm font-bold tabular-nums text-gray-950 dark:text-white">{loading ? '-' : errors.visits ? '--' : totalVisits}</dd>
          <dt className="mt-0.5 text-[10px] text-gray-400">家访 / 到校</dt>
        </div>
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {canViewReportCenter && (
          <Link to="/admin/report-center?tab=summary" className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-gray-200 text-[11px] font-medium text-gray-600 hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300">
            报表中心 <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
        {canViewLeadsManage && (
          <Link to="/admin/leads" className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-gray-200 text-[11px] font-medium text-gray-600 hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300">
            学生全量 <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </section>
  );
}

export default function AdminOpsRail({
  dailyOps,
  dailyOpsLoading,
  dailyOpsError,
  dailyOpsSavingKey,
  canReviewDailyOps,
  onMarkDailyOps,
  actionItems,
  actionItemsError,
  loading,
  enrollmentData,
  visitSummary,
  quality,
  overviewErrors,
  onRetry,
  canViewLeadsManage,
  canViewReportCenter,
  className = '',
}) {
  return (
    <aside className={`flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}>
      <div className="shrink-0 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-950 dark:text-white">运营与流转控制台</h2>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">从线索分配到风险闭环，保持同屏决策。</p>
      </div>
      <div>
        <DailyOps
          dailyOps={dailyOps}
          loading={dailyOpsLoading}
          error={dailyOpsError}
          savingKey={dailyOpsSavingKey}
          canReview={canReviewDailyOps}
          onMark={onMarkDailyOps}
          onRetry={onRetry}
        />
        <RiskQueue
          items={actionItems}
          loading={loading}
          error={actionItemsError}
          onRetry={onRetry}
        />
        <OperationalOverview
          enrollmentData={enrollmentData}
          visitSummary={visitSummary}
          quality={quality}
          loading={loading}
          errors={overviewErrors}
          onRetry={onRetry}
          canViewLeadsManage={canViewLeadsManage}
          canViewReportCenter={canViewReportCenter}
        />
      </div>
    </aside>
  );
}
