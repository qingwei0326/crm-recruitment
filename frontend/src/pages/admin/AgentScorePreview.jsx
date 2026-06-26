import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  Moon,
  Phone,
  RefreshCw,
  SlidersHorizontal,
  Sun,
  Target,
} from 'lucide-react';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import { getApiErrorMessage } from '../../utils';

const levelClass = {
  excellent: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  good: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  watch: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  risk: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const signalClass = {
  critical: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
  warning: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
  info: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-700/50 dark:text-gray-300 dark:border-gray-600',
};

const filters = [
  { key: 'all', label: '全部' },
  { key: 'attention', label: '需关注' },
  { key: 'overdue', label: '逾期回访' },
  { key: 'low_calls', label: '低通话量' },
];

const sortOptions = [
  { key: 'score_asc', label: '分数从低到高' },
  { key: 'overdue_desc', label: '逾期回访最多' },
  { key: 'calls_asc', label: '通话量从低到高' },
];

function StatCell({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <Icon className="w-4 h-4" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

function ScoreBadge({ item }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {Number(item.score || 0).toFixed(1)}
      </span>
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${levelClass[item.level] || levelClass.watch}`}>
        {item.level_label || '-'}
      </span>
    </div>
  );
}

function ComponentBar({ component }) {
  const max = Number(component?.max || 0);
  const score = Number(component?.score || 0);
  const pct = max > 0 ? Math.min(100, Math.max(0, (score / max) * 100)) : 0;
  return (
    <div className="min-w-[8rem]">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-gray-500 dark:text-gray-400">{component?.label || '-'}</span>
        <span className="font-medium text-gray-700 dark:text-gray-200 tabular-nums">
          {score.toFixed(1)}/{max.toFixed(0)}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SignalList({ signals }) {
  if (!signals?.length) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
        <CheckCircle2 className="w-3 h-3" />
        正常
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {signals.map((signal) => (
        <span
          key={signal.key}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${signalClass[signal.severity] || signalClass.info}`}
        >
          {signal.severity === 'critical' ? <AlertTriangle className="w-3 h-3" /> : null}
          {signal.label}
        </span>
      ))}
    </div>
  );
}

export default function AgentScorePreview() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dailyCallTarget, setDailyCallTarget] = useState(30);
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('score_asc');
  const [data, setData] = useState({ items: [] });
  const closeSidebar = () => setSidebarOpen(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/agent-score-preview', {
        params: { daily_call_target: dailyCallTarget },
      });
      setData(res.data.data || { items: [] });
    } catch (error) {
      setData({ items: [] });
      toast?.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    const items = data.items || [];
    return {
      total: items.length,
      attention: items.filter((item) => ['risk', 'watch'].includes(item.level)).length,
      overdue: items.reduce((sum, item) => sum + Number(item.metrics?.overdue_follow_ups || 0), 0),
      calls: items.reduce((sum, item) => sum + Number(item.metrics?.today_calls || 0), 0),
    };
  }, [data.items]);

  const filteredItems = useMemo(() => {
    const items = [...(data.items || [])];
    const visible = items.filter((item) => {
      if (filter === 'attention') return ['risk', 'watch'].includes(item.level);
      if (filter === 'overdue') return Number(item.metrics?.overdue_follow_ups || 0) > 0;
      if (filter === 'low_calls') {
        return item.signals?.some((signal) => signal.key === 'low_call_activity');
      }
      return true;
    });
    visible.sort((a, b) => {
      if (sortBy === 'overdue_desc') {
        return (
          Number(b.metrics?.overdue_follow_ups || 0) -
          Number(a.metrics?.overdue_follow_ups || 0)
        );
      }
      if (sortBy === 'calls_asc') {
        return Number(a.metrics?.today_calls || 0) - Number(b.metrics?.today_calls || 0);
      }
      return Number(a.score || 0) - Number(b.score || 0);
    });
    return visible;
  }, [data.items, filter, sortBy]);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="评分预览"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          actionsClassName="flex items-center gap-2"
          useSafeArea={false}
        >
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            aria-label="刷新"
          >
            <RefreshCw className={`w-5 h-5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={toggle}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={dark ? '亮色模式' : '暗色模式'}
          >
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
        </PageHeader>

        <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <StatCell icon={Activity} label="话务员" value={summary.total} />
            <StatCell icon={AlertTriangle} label="需关注" value={summary.attention} />
            <StatCell icon={Clock3} label="逾期回访" value={summary.overdue} />
            <StatCell icon={Phone} label="今日通话" value={summary.calls} />
          </div>

          <section className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 lg:mr-auto">
                <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                试算参数
              </div>
              <label className="grid gap-1 text-sm text-gray-600 dark:text-gray-300">
                <span>通话目标</span>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={dailyCallTarget}
                  onChange={(e) => setDailyCallTarget(Number(e.target.value || 1))}
                  className="w-full lg:w-32 px-3 py-2 rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </label>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                重新试算
              </button>
            </div>
          </section>

          <section className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex flex-wrap gap-2 lg:mr-auto">
                {filters.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${
                      filter === item.key
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <span className="shrink-0">排序</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full lg:w-44 px-3 py-2 rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {sortOptions.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                当前 {filteredItems.length} / {summary.total}
              </div>
            </div>
          </section>

          <section className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            {loading ? (
              <div className="py-16 flex items-center justify-center text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (data.items || []).length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">
                暂无评分数据
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">
                当前筛选暂无匹配话务员
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium min-w-[12rem]">话务员</th>
                      <th className="px-4 py-3 text-left font-medium min-w-[9rem]">分数</th>
                      <th className="px-4 py-3 text-left font-medium min-w-[22rem]">分项</th>
                      <th className="px-4 py-3 text-left font-medium min-w-[16rem]">指标</th>
                      <th className="px-4 py-3 text-left font-medium min-w-[18rem]">风险信号</th>
                      <th className="px-4 py-3 text-left font-medium min-w-[18rem]">建议动作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {filteredItems.map((item) => (
                      <tr key={item.agent.id} className="align-top hover:bg-gray-50 dark:hover:bg-gray-900/30">
                        <td className="px-4 py-4">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {item.agent.name}
                          </div>
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            @{item.agent.username}
                            {item.agent.service_regions ? ` · ${item.agent.service_regions}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <ScoreBadge item={item} />
                        </td>
                        <td className="px-4 py-4">
                          <div className="grid gap-2 md:grid-cols-2">
                            {Object.entries(item.components || {}).map(([key, component]) => (
                              <ComponentBar key={key} component={component} />
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-600 dark:text-gray-300">
                            <span>活跃 {item.metrics.active_tasks}</span>
                            <span>推进 {item.metrics.progress_pct}%</span>
                            <span>通话 {item.metrics.today_calls}</span>
                            <span>回访 {item.metrics.open_follow_ups}</span>
                            <span>A 意向 {item.metrics.a_level_count}</span>
                            <span>报名 {item.metrics.enrolled_count}</span>
                            <span>备注 {item.metrics.notes_today}</span>
                            <span>完整 {item.metrics.data_completeness_pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <SignalList signals={item.signals} />
                        </td>
                        <td className="px-4 py-4 text-gray-700 dark:text-gray-200">
                          {item.recommended_action}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
