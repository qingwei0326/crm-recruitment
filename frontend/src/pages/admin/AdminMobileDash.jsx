import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Eye,
  Gauge,
  ListFilter,
  Loader2,
  Moon,
  Phone,
  RefreshCw,
  Search,
  Settings,
  Sun,
  UserRound,
  Users,
} from 'lucide-react';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { formatDuration, getApiErrorMessage } from '../../utils';
import { leadFilterUrl } from './adminWorkflow';

const metricTone = {
  blue: 'border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-300',
  green: 'border-green-100 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300',
  amber: 'border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300',
  red: 'border-red-100 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300',
  gray: 'border-gray-100 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200',
};

function n(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function MetricCard({ icon: Icon, label, value, detail, tone = 'gray', to }) {
  const body = (
    <div className={`min-h-[112px] rounded-xl border p-3 ${metricTone[tone] || metricTone.gray}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium opacity-80">{label}</div>
        <Icon className="h-4 w-4 shrink-0 opacity-80" />
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
      {detail && <div className="mt-1 text-xs leading-4 opacity-75">{detail}</div>}
    </div>
  );
  if (!to) return body;
  return <Link to={to}>{body}</Link>;
}

function QuickAction({ icon: Icon, title, detail, tone = 'gray', to }) {
  return (
    <Link
      to={to}
      className={`flex min-h-[72px] items-center gap-3 rounded-xl border px-3 py-3 ${metricTone[tone] || metricTone.gray}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/70 dark:bg-gray-900/40">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs leading-4 opacity-75">{detail}</div>
      </div>
    </Link>
  );
}

function AgentRow({ item }) {
  const metrics = item.metrics || {};
  const needsAttention = ['risk', 'watch'].includes(item.level);
  return (
    <Link
      to={`/admin/score-preview?filter=${needsAttention ? 'attention' : 'all'}`}
      className="block rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              {item.agent?.name || '-'}
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                needsAttention
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              }`}
            >
              {item.level_label || (needsAttention ? '关注' : '正常')}
            </span>
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            拨号 {n(metrics.today_calls)} · 有效 {n(metrics.today_recorded_calls)} · 未记录 {n(metrics.today_unrecorded_calls)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            {Number(item.score || 0).toFixed(1)}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            均长 {formatDuration(metrics.avg_recorded_duration_seconds)}
          </div>
        </div>
      </div>
      {item.recommended_action && (
        <div className="mt-2 rounded-lg bg-gray-50 px-2 py-1.5 text-xs leading-5 text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
          {item.recommended_action}
        </div>
      )}
    </Link>
  );
}

export default function AdminMobileDash() {
  const { dark, toggle } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState(null);
  const [quality, setQuality] = useState(null);
  const [opsHealth, setOpsHealth] = useState(null);
  const [scorePreview, setScorePreview] = useState({ items: [] });

  const closeSidebar = () => setSidebarOpen(false);

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [summaryRes, qualityRes, opsRes, scoreRes] = await Promise.all([
        api.get('/stats/dashboard-summary'),
        api.get('/admin/data-quality'),
        api.get('/admin/ops-health'),
        api.get('/admin/agent-score-preview', { params: { daily_call_target: 30 } }),
      ]);
      setSummary(summaryRes.data.data || {});
      setQuality(qualityRes.data.data || {});
      setOpsHealth(opsRes.data.data || {});
      setScorePreview(scoreRes.data.data || { items: [] });
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const scoreItems = scorePreview.items || [];
  const attentionAgents = useMemo(
    () => scoreItems.filter((item) => ['risk', 'watch'].includes(item.level)),
    [scoreItems],
  );
  const topAttentionAgents = useMemo(() => {
    const items = attentionAgents.length ? attentionAgents : scoreItems;
    return [...items]
      .sort((a, b) => {
        const levelWeight = { risk: 0, watch: 1, good: 2, excellent: 3 };
        const levelDiff = (levelWeight[a.level] ?? 2) - (levelWeight[b.level] ?? 2);
        if (levelDiff !== 0) return levelDiff;
        return Number(a.score || 0) - Number(b.score || 0);
      })
      .slice(0, 3);
  }, [attentionAgents, scoreItems]);

  const today = quality?.calls?.today || {};
  const month = quality?.calls?.month || {};
  const students = quality?.students || {};
  const followUps = quality?.follow_ups || {};
  const business = opsHealth?.business || {};
  const canViewSystemSettings = Boolean(user?.is_super_admin);
  const totalCalls = n(today.total_calls || summary?.today_calls);
  const recordedCalls = n(today.recorded_calls);
  const unrecordedCalls = n(today.unrecorded_calls);
  const unrecordedRatio = n(month.unrecorded_ratio);
  const hasCritical =
    n(followUps.overdue_follow_ups) > 0 ||
    n(students.missing_phone_tasks) > 0 ||
    n(students.unassigned_active) > 0 ||
    n(business.notification_failures_7d) > 0 ||
    attentionAgents.length > 0;

  return (
    <AdminLayout isMobile sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="min-w-0 flex-1">
        <PageHeader
          title="移动管理"
          isMobile
          onMenuClick={() => setSidebarOpen(true)}
          actionsClassName="flex items-center gap-1"
        >
          <button
            type="button"
            onClick={() => load({ silent: true })}
            disabled={refreshing}
            aria-label="刷新移动管理"
            className="rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-5 w-5 text-gray-500 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={dark ? '亮色模式' : '暗色模式'}
            className="rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {dark ? <Sun className="h-5 w-5 text-amber-400" /> : <Moon className="h-5 w-5 text-gray-500" />}
          </button>
        </PageHeader>

        <div className="space-y-4 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <section className={`rounded-2xl border px-4 py-4 ${hasCritical ? metricTone.amber : metricTone.green}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {hasCritical ? '今日有事项需要处理' : '今日运行平稳'}
                </div>
                <div className="mt-1 text-xs leading-5 opacity-80">
                  先看异常和话务员状态，再进入学生管理做细节处理。
                </div>
              </div>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : hasCritical ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <MetricCard
              icon={Phone}
              label="今日拨号"
              value={loading ? '-' : totalCalls}
              detail={`有效 ${recordedCalls} · 未记录 ${unrecordedCalls}`}
              tone={unrecordedCalls > 0 ? 'amber' : 'blue'}
              to="/admin/report-center?tab=call-volume"
            />
            <MetricCard
              icon={Clock3}
              label="逾期回访"
              value={loading ? '-' : n(followUps.overdue_follow_ups)}
              detail={`未完成 ${n(followUps.open_follow_ups)}`}
              tone={n(followUps.overdue_follow_ups) > 0 ? 'red' : 'green'}
              to="/admin/work-center?queue=follow"
            />
            <MetricCard
              icon={Users}
              label="未分配线索"
              value={loading ? '-' : n(students.unassigned_active)}
              detail="需要尽快分给话务员"
              tone={n(students.unassigned_active) > 0 ? 'amber' : 'green'}
              to={leadFilterUrl({ assignment: 'unassigned' })}
            />
            <MetricCard
              icon={Gauge}
              label="需关注坐席"
              value={loading ? '-' : attentionAgents.length}
              detail={`共 ${scoreItems.length} 名话务员`}
              tone={attentionAgents.length > 0 ? 'amber' : 'green'}
              to="/admin/score-preview?filter=attention"
            />
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">异常处理</h2>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">手机端只保留高频处理入口</div>
              </div>
              {canViewSystemSettings && (
                <Link to="/admin/settings" className="text-xs text-blue-600 dark:text-blue-300">
                  数据质量
                </Link>
              )}
            </div>
            <div className="space-y-2">
              <QuickAction
                icon={AlertTriangle}
                title="缺电话任务"
                detail={`${n(students.missing_phone_tasks)} 条待补手机号`}
                tone={n(students.missing_phone_tasks) > 0 ? 'red' : 'green'}
                to="/admin/leads"
              />
              <QuickAction
                icon={Clock3}
                title="未记录通话"
                detail={`今日 ${unrecordedCalls} 通，本月占比 ${unrecordedRatio}%`}
                tone={unrecordedCalls > 0 ? 'amber' : 'green'}
                to="/admin/report-center?tab=call-volume"
              />
              <QuickAction
                icon={ListFilter}
                title="无效线索"
                detail={`${n(students.invalid_total)} 条，查看无效原因和回收`}
                tone={n(students.invalid_total) > 0 ? 'blue' : 'gray'}
                to={leadFilterUrl({ status: '无效' })}
              />
              {canViewSystemSettings && (
                <QuickAction
                  icon={Settings}
                  title="系统运行"
                  detail={`通知失败 ${n(business.notification_failures_7d)} · 锁定账号 ${n(business.locked_users)}`}
                  tone={n(business.notification_failures_7d) > 0 || n(business.locked_users) > 0 ? 'amber' : 'green'}
                  to="/admin/settings"
                />
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">话务员概览</h2>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">优先展示风险或低分坐席</div>
              </div>
              <Link to="/admin/score-preview" className="text-xs text-blue-600 dark:text-blue-300">
                评分预览
              </Link>
            </div>
            {loading ? (
              <div className="flex justify-center py-6 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : topAttentionAgents.length ? (
              <div className="space-y-2">
                {topAttentionAgents.map((item) => (
                  <AgentRow key={item.agent?.id || item.agent?.username} item={item} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-gray-50 px-3 py-6 text-center text-sm text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                暂无话务员评分数据
              </div>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3">
            <QuickAction
              icon={Search}
              title="查学生"
              detail="姓名、电话、学校"
              tone="blue"
              to="/admin/leads"
            />
            <QuickAction
              icon={Eye}
              title="A 级意向"
              detail={`${n(summary?.a_level)} 条重点线索`}
              tone="green"
              to={leadFilterUrl({ intent: 'A' })}
            />
            <QuickAction
              icon={UserRound}
              title="话务员"
              detail="账号与任务"
              tone="gray"
              to="/admin/agents"
            />
            <QuickAction
              icon={BarChart3}
              title="报表"
              detail="趋势和通话"
              tone="gray"
              to="/admin/report-center"
            />
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
