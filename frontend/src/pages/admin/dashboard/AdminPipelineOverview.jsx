import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  BarChart3,
  Gauge,
  MapPin,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { STAGES, stageLabel } from '../../../labels';
import FunnelChart from '../FunnelChart';
import DashboardPanelError from './DashboardPanelError';

const metricTone = {
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
};

const compactStageLabel = {
  '初次联系': '新线索',
  '有意向': '意向跟进',
  '已送资料': '已送资料',
  '待家访': '待家访',
  '家访已安排': '家访安排',
  '家访完成': '家访完成',
  '待到校参观': '待到校',
  '到校参观已安排': '到校安排',
  '已到校参观': '已到校',
  '已报名': '已报名',
};

export function AdminMetricStrip({ cards, loading, onRetry }) {
  return (
    <section
      className={`grid shrink-0 grid-cols-2 gap-3 ${cards.length > 2 ? 'lg:grid-cols-4' : 'lg:grid-cols-2'}`}
      aria-label="今日核心指标"
    >
      {cards.map((card) => {
        const content = (
          <>
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${metricTone[card.tone]}`}>
              <card.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black tabular-nums text-gray-950 dark:text-white xl:text-3xl">
                  {loading ? '-' : card.error ? '--' : card.value}
                </span>
                <span className="min-w-0 break-words text-xs font-semibold leading-4 text-gray-500 dark:text-gray-400 xl:text-sm">
                  {card.label}
                </span>
              </div>
              <div className="mt-0.5 truncate text-2xs text-gray-400 dark:text-gray-500">
                {card.error ? '指标加载失败，请重试' : card.detail}
              </div>
            </div>
            {card.error ? (
              <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 rotate-[-45deg] text-amber-500" />
            ) : card.to ? (
              <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-300" />
            ) : null}
          </>
        );
        const className =
          'flex min-h-[104px] items-center gap-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm transition dark:border-gray-800 dark:bg-gray-900 xl:p-6';

        return card.error ? (
          <button
            key={card.label}
            type="button"
            onClick={onRetry}
            disabled={loading}
            aria-label={`重试${card.label}`}
            className={`${className} text-left hover:border-amber-300 disabled:opacity-70 dark:hover:border-amber-800`}
          >
            {content}
          </button>
        ) : card.to ? (
          <Link
            key={card.label}
            to={card.to}
            className={`${className} hover:border-blue-300 hover:shadow dark:hover:border-blue-700`}
          >
            {content}
          </Link>
        ) : (
          <div key={card.label} className={className}>
            {content}
          </div>
        );
      })}
    </section>
  );
}

function StageDistribution({ stageStats, canViewLeadsManage, error, onRetry, retrying }) {
  const maxValue = Math.max(...Object.values(stageStats || {}).map(Number), 1);

  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 xl:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="min-w-0">
            <h2 className="truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
              各阶段线索实时沉淀与工作进展
            </h2>
            <p className="mt-0.5 text-3xs text-gray-400">点击阶段直达对应学生列表</p>
          </div>
        </div>
        <span className="shrink-0 rounded bg-blue-50 px-2 py-1 text-3xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
          全盘动态
        </span>
      </div>

      {error ? (
        <div className="mt-4">
          <DashboardPanelError title="阶段分布" onRetry={onRetry} retrying={retrying} />
        </div>
      ) : (
        <div
          className="mt-5 grid h-48 gap-1.5 border-b border-gray-200 dark:border-gray-800 xl:gap-3"
          style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }}
        >
        {STAGES.map((stage) => {
          const count = Number(stageStats?.[stage] || 0);
          const height = count > 0 ? Math.max((count / maxValue) * 100, 4) : 0;
          const content = (
            <>
              <span className="flex h-5 items-center justify-center text-3xs font-bold tabular-nums text-gray-600 group-hover:text-blue-600 dark:text-gray-300 dark:group-hover:text-blue-400">
                {count.toLocaleString()}
              </span>
              <span className="relative flex min-h-0 flex-1 items-end justify-center overflow-hidden">
                <span
                  className="block w-full max-w-12 rounded-t-lg bg-gradient-to-t from-blue-600 to-indigo-500 shadow-sm shadow-blue-500/10 transition-all duration-300 group-hover:from-blue-500 group-hover:to-indigo-400 dark:from-blue-700 dark:to-indigo-600"
                  style={{ height: `${height}%` }}
                />
              </span>
              <span className="flex h-10 items-start justify-center px-0.5 pt-1.5 text-center text-[9px] font-medium leading-3 text-gray-500 dark:text-gray-400">
                {compactStageLabel[stage] || stageLabel(stage)}
              </span>
            </>
          );
          const className = 'group grid min-w-0 grid-rows-[20px_minmax(0,1fr)_40px]';

          return canViewLeadsManage ? (
            <Link
              key={stage}
              to={`/admin/leads?stage=${encodeURIComponent(stage)}`}
              className={className}
              title={`${stageLabel(stage)}：${count} 人`}
            >
              {content}
            </Link>
          ) : (
            <div key={stage} className={className} title={`${stageLabel(stage)}：${count} 人`}>
              {content}
            </div>
          );
        })}
        </div>
      )}
    </section>
  );
}

function ConversionFunnel({ funnelData, error, onRetry, retrying }) {
  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 xl:p-5">
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        <h2 className="text-xs font-semibold text-gray-900 dark:text-gray-100">全链路招生流转漏斗</h2>
      </div>
      {error ? (
        <DashboardPanelError title="招生漏斗" onRetry={onRetry} retrying={retrying} />
      ) : funnelData ? (
        <FunnelChart data={funnelData} />
      ) : (
        <div className="flex h-40 items-center justify-center text-xs text-gray-400">暂无漏斗数据</div>
      )}
    </section>
  );
}

function AgentWorkStatus({ scoreItems = [], error, onRetry, retrying }) {
  const agents = [...scoreItems]
    .sort((a, b) => Number(b.metrics?.today_calls || 0) - Number(a.metrics?.today_calls || 0))
    .slice(0, 5);

  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 xl:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <UserRound className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <div className="min-w-0">
            <h2 className="truncate text-xs font-semibold text-gray-900 dark:text-gray-100">话务员工作状态</h2>
            <p className="mt-0.5 text-3xs text-gray-400">按今日呼出量查看执行进度</p>
          </div>
        </div>
        <Link to="/admin/score-preview" className="shrink-0 text-3xs font-medium text-blue-600 hover:underline dark:text-blue-400">坐席明细</Link>
      </div>
      {error ? (
        <DashboardPanelError title="话务员状态" onRetry={onRetry} retrying={retrying} />
      ) : agents.length === 0 ? (
        <div className="flex h-28 items-center justify-center text-xs text-gray-400">暂无坐席数据</div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {agents.map((item) => {
            const calls = Number(item.metrics?.today_calls || 0);
            const target = Math.max(Number(item.metrics?.daily_call_target || 30), 1);
            const progress = Math.min((calls / target) * 100, 100);
            const attention = ['risk', 'watch'].includes(item.level);
            return (
              <Link key={item.agent?.id || item.agent?.username || item.agent_name} to="/admin/score-preview" className="block py-2.5 first:pt-0 last:pb-0 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-medium text-gray-800 dark:text-gray-100">{item.agent?.name || item.agent_name || '未命名坐席'}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-3xs ${attention ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>{item.level_label || (attention ? '需关注' : '正常')}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><div className={`h-full rounded-full ${attention ? 'bg-amber-500' : 'bg-violet-500'}`} style={{ width: `${progress}%` }} /></div>
                  <span className="w-16 shrink-0 text-right text-3xs tabular-nums text-gray-500 dark:text-gray-400">{calls} / {target} 通</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AssignmentCapacity({ availableUnassigned = 0, totalStudents = 0, aLevelTotal = 0, loading, error, onRetry, retrying }) {
  const total = Number(totalStudents || 0);
  const unassigned = Number(availableUnassigned || 0);
  const assignedRate = total > 0 ? Math.round(((total - unassigned) / total) * 100) : 0;
  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 xl:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><Gauge className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" /><div><h2 className="text-xs font-semibold text-gray-900 dark:text-gray-100">分配池与处理容量</h2><p className="mt-0.5 text-3xs text-gray-400">快速判断线索是否需要补充承接</p></div></div>
        <Link to="/admin/leads?assignment=unassigned&active=1" className="shrink-0 text-3xs font-medium text-blue-600 hover:underline dark:text-blue-400">去分配</Link>
      </div>
      {error ? <DashboardPanelError title="分配池数据" onRetry={onRetry} retrying={retrying} /> : (
        <>
          <div className="grid grid-cols-3 divide-x divide-gray-100 rounded-xl bg-gray-50 py-3 text-center dark:divide-gray-800 dark:bg-gray-800/60">
            <div><div className="text-lg font-black tabular-nums text-gray-950 dark:text-white">{loading ? '-' : unassigned.toLocaleString()}</div><div className="text-3xs text-gray-400">待分配</div></div>
            <div><div className="text-lg font-black tabular-nums text-gray-950 dark:text-white">{loading ? '-' : total.toLocaleString()}</div><div className="text-3xs text-gray-400">全盘线索</div></div>
            <div><div className="text-lg font-black tabular-nums text-amber-600 dark:text-amber-400">{loading ? '-' : Number(aLevelTotal || 0).toLocaleString()}</div><div className="text-3xs text-gray-400">A级重点</div></div>
          </div>
          <div className="mt-4 flex items-center justify-between text-3xs text-gray-500 dark:text-gray-400"><span>已进入承接流程</span><span className="font-bold tabular-nums text-gray-800 dark:text-gray-200">{loading ? '-' : `${Math.max(0, Math.min(assignedRate, 100))}%`}</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600" style={{ width: `${Math.max(0, Math.min(assignedRate, 100))}%` }} /></div>
        </>
      )}
    </section>
  );
}

function RegionRanking({ stats, error, onRetry, retrying }) {
  const rankedRegions = useMemo(
    () => [...stats]
      .sort((a, b) => Number(b.conversion_rate || 0) - Number(a.conversion_rate || 0))
      .slice(0, 5),
    [stats],
  );

  return (
    <section className="flex min-h-[230px] flex-col rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 xl:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <h2 className="truncate text-xs font-semibold text-gray-900 dark:text-gray-100">核心地域招生转化效率排位</h2>
        </div>
        <span className="shrink-0 text-3xs text-gray-400">Top 5</span>
      </div>

      {error ? (
        <DashboardPanelError title="地域转化" onRetry={onRetry} retrying={retrying} />
      ) : rankedRegions.length > 0 ? (
        <div className="flex-1 space-y-3 overflow-y-auto pr-1 scroll-thin">
          {rankedRegions.map((region) => {
            const rate = Math.min(Math.max(Number(region.conversion_rate || 0), 0), 100);
            const barClass = rate >= 50 ? 'bg-emerald-500' : rate >= 20 ? 'bg-amber-500' : 'bg-blue-500';
            return (
              <div key={region.source} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-medium text-gray-700 dark:text-gray-300">{region.source}</span>
                  <span className="shrink-0 font-bold tabular-nums text-gray-900 dark:text-white">{rate}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
                  <div className={`h-full rounded transition-all duration-500 ${barClass}`} style={{ width: `${rate}%` }} />
                </div>
                <div className="text-[9px] tabular-nums text-gray-400">
                  {Number(region.a_count || 0).toLocaleString()} 名 A 级 · {Number(region.total || 0).toLocaleString()} 名学生
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-gray-400">暂无地域转化数据</div>
      )}
    </section>
  );
}

export default function AdminPipelineOverview({
  stageStats,
  funnelData,
  stats,
  scoreItems = [],
  availableUnassigned = 0,
  totalStudents = 0,
  aLevelTotal = 0,
  loading = false,
  canViewLeadsManage,
  errors = {},
  onRetry,
  retrying = false,
  className = '',
}) {
  return (
    <div className={`space-y-4 ${className}`}>
      <StageDistribution
        stageStats={stageStats}
        canViewLeadsManage={canViewLeadsManage}
        error={errors.stages}
        onRetry={onRetry}
        retrying={retrying}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:gap-6">
        <AgentWorkStatus scoreItems={scoreItems} error={errors.agents} onRetry={onRetry} retrying={retrying} />
        <AssignmentCapacity
          availableUnassigned={availableUnassigned}
          totalStudents={totalStudents}
          aLevelTotal={aLevelTotal}
          loading={loading}
          error={errors.capacity}
          onRetry={onRetry}
          retrying={retrying}
        />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:gap-6">
        <ConversionFunnel
          funnelData={funnelData}
          error={errors.funnel}
          onRetry={onRetry}
          retrying={retrying}
        />
        <RegionRanking
          stats={stats}
          error={errors.regions}
          onRetry={onRetry}
          retrying={retrying}
        />
      </div>
    </div>
  );
}
