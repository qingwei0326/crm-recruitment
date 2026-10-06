import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Eye,
  Gauge,
  Globe2,
  HelpCircle,
  ListFilter,
  Loader2,
  Moon,
  Phone,
  RefreshCw,
  Search,
  Settings,
  Sun,
  TrendingUp,
  UserRound,
  Users,
} from 'lucide-react';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import HelpModal from '../../components/HelpModal';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { formatDuration, getApiErrorMessage } from '../../utils';
import { dashboardLeadUrls, leadFilterUrl } from './adminWorkflow';
import { ADMIN_PAGE_PERMISSIONS, canAccessAdminPage } from '../../adminPermissions';
import {
  DashboardCardPicker,
  hasDashboardCardData,
  useDashboardCardPreferences,
} from './dashboard/DashboardCardPicker';

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

function recordingCounts(metrics = {}) {
  const compatibilityUnrecorded = n(metrics.unrecorded_calls);
  return {
    completed: n(metrics.completed_dial_sessions ?? metrics.recorded_calls),
    pending: n(
      metrics.pending_dial_sessions == null
        ? compatibilityUnrecorded
        : metrics.pending_dial_sessions,
    ),
    legacy: n(metrics.legacy_missing_duration),
  };
}

function todayRecordingCounts(metrics = {}) {
  const compatibilityUnrecorded = n(metrics.today_unrecorded_calls);
  return {
    completed: n(metrics.today_recorded_calls),
    pending: n(
      metrics.today_pending_dial_sessions == null
        ? compatibilityUnrecorded
        : metrics.today_pending_dial_sessions,
    ),
    legacy: n(metrics.today_legacy_missing_duration),
  };
}

function MetricCard({ icon: Icon, label, value, detail, tone = 'gray', to }) {
  const body = (
    <div className={`group min-h-[116px] rounded-panel border p-4 shadow-sm transition hover:shadow-md ${metricTone[tone] || metricTone.gray}`}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 break-words text-xs font-semibold leading-4 opacity-80">{label}</div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-panel bg-white/70 dark:bg-gray-900/40">
          <Icon className="h-4 w-4 opacity-80" />
        </div>
      </div>
      <div className="mt-3 truncate text-2xl font-black tabular-nums">{value}</div>
      {detail && <div className="mt-1 break-words text-xs leading-4 opacity-75">{detail}</div>}
    </div>
  );
  if (!to) return body;
  return <Link to={to}>{body}</Link>;
}

function QuickAction({ icon: Icon, title, detail, tone = 'gray', to }) {
  const body = (
    <div className={`flex min-h-[72px] items-center gap-3 rounded-panel border px-3 py-3 ${metricTone[tone] || metricTone.gray}`}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/70 dark:bg-gray-900/40">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="break-words text-sm font-semibold leading-5">{title}</div>
        <div className="mt-0.5 break-words text-xs leading-4 opacity-75">{detail}</div>
      </div>
    </div>
  );
  if (!to) return body;
  return <Link to={to}>{body}</Link>;
}

function AgentRow({ item }) {
  const metrics = item.metrics || {};
  const recording = todayRecordingCounts(metrics);
  const needsAttention = ['risk', 'watch'].includes(item.level);
  return (
    <Link
      to={`/admin/score-preview?filter=${needsAttention ? 'attention' : 'all'}`}
      className="block rounded-panel border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              {item.agent?.name || '-'}
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-2xs ${
                needsAttention
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              }`}
            >
              {item.level_label || (needsAttention ? '关注' : '正常')}
            </span>
          </div>
          <div className="mt-1 break-words text-xs leading-4 text-gray-500 dark:text-gray-400">
            拨号 {n(metrics.today_calls)} · 已完成 {recording.completed} · 待完成 {recording.pending} · 历史未回填 {recording.legacy}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            {Number(item.score || 0).toFixed(1)}
          </div>
          <div className="text-2xs text-gray-500 dark:text-gray-400">
            流程均耗 {Number(metrics.avg_recorded_duration_seconds || 0) > 0
              ? formatDuration(metrics.avg_recorded_duration_seconds)
              : '-'}
          </div>
        </div>
      </div>
      {item.recommended_action && (
        <div className="mt-2 rounded-lg bg-gray-50 px-2 py-1.5 text-xs leading-5 text-gray-600 break-words dark:bg-gray-900/50 dark:text-gray-300">
          {item.recommended_action}
        </div>
      )}
    </Link>
  );
}

function MobileGlobalOverview({ summary, enrolledTotal, loading }) {
  const cells = [
    ['全盘线索', summary?.total_students, '当前全部学生'],
    ['已联系学生', summary?.contacted, '排除未联系与无效'],
    ['A级意向', summary?.a_level, '当前重点跟进'],
    ['已报名', enrolledTotal, '当前确认报名'],
  ];

  return (
    <section className="overflow-hidden rounded-panel border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
        <div>
          <h2 className="text-xs font-bold tracking-wide text-gray-900 dark:text-gray-100">全局数据总览</h2>
          <p className="mt-0.5 text-3xs text-gray-400">全库实时口径</p>
        </div>
        <Globe2 className="h-4 w-4 text-blue-500" />
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-gray-100 dark:divide-gray-700">
        {cells.map(([label, value, detail]) => (
          <div key={label} className="min-w-0 px-4 py-3">
            <div className="truncate text-3xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
            <div className="mt-1 text-lg font-black tabular-nums text-gray-950 dark:text-white">
              {loading ? '-' : n(value).toLocaleString()}
            </div>
            <div className="mt-0.5 truncate text-3xs text-gray-400">{detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AdminMobileDash() {
  const { dark, toggle } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState('today');
  const [summary, setSummary] = useState(null);
  const [quality, setQuality] = useState(null);
  const [opsHealth, setOpsHealth] = useState(null);
  const [scorePreview, setScorePreview] = useState({ items: [] });
  const [helpOpen, setHelpOpen] = useState(false);
  const canViewScorePreview = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.scorePreview);
  const canViewAccountManage = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.accountManage);
  const canViewReportCenter = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.reportCenter);
  const canViewWorkCenter = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.workCenter);
  const canViewLeadsManage = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.leadsManage);

  const closeSidebar = () => setSidebarOpen(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [summaryRes, qualityRes, opsRes, scoreRes] = await Promise.all([
        api.get('/stats/dashboard-summary'),
        api.get('/admin/data-quality'),
        api.get('/admin/ops-health'),
        canViewScorePreview
          ? api.get('/admin/agent-score-preview', { params: { daily_call_target: 30 } })
          : Promise.resolve({ data: { data: { items: [] } } }),
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
  }, [canViewScorePreview, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const scoreItems = useMemo(() => scorePreview.items || [], [scorePreview.items]);
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
  const totalCalls = n(summary?.today_calls ?? today.total_calls);
  const todayRecording = recordingCounts(today);
  const monthRecording = recordingCounts(month);
  const todayA = n(summary?.today_a);
  const availableUnassigned = n(summary?.available_unassigned ?? students.unassigned_active);
  const totalStudents = n(summary?.total_students);
  const contactedStudents = n(summary?.contacted);
  const aLevelTotal = n(summary?.a_level);
  const enrolledTotal = n(summary?.enrolled_total);
  const hasCritical =
    n(followUps.overdue_follow_ups) > 0 ||
    n(students.missing_phone_tasks) > 0 ||
    availableUnassigned > 0 ||
    n(business.notification_failures_7d) > 0 ||
    (canViewScorePreview && attentionAgents.length > 0);

  const metricCards = useMemo(() => {
    if (scope === 'today') {
      return [
        {
          key: 'today-calls',
          icon: Phone,
          label: '今日呼出',
          value: totalCalls,
          detail: `已完成 ${todayRecording.completed} · 待完成 ${todayRecording.pending}`,
          tone: todayRecording.pending > 0 ? 'amber' : 'blue',
          to: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '',
        },
        {
          key: 'today-a',
          icon: TrendingUp,
          label: '今日新增 A',
          value: todayA,
          detail: '今日评级进入 A',
          tone: todayA > 0 ? 'green' : 'gray',
          to: canViewLeadsManage ? dashboardLeadUrls.todayA : '',
        },
        {
          key: 'available-unassigned',
          icon: Users,
          label: '可分配有效线索',
          value: availableUnassigned,
          detail: '未分配且仍需跟进',
          tone: availableUnassigned > 0 ? 'amber' : 'green',
          to: canViewLeadsManage ? dashboardLeadUrls.availableUnassigned : '',
        },
        {
          key: 'attention-agents',
          icon: Gauge,
          label: '需关注坐席',
          value: attentionAgents.length,
          detail: `共 ${scoreItems.length} 名话务员`,
          tone: attentionAgents.length > 0 ? 'amber' : 'green',
          to: canViewScorePreview ? '/admin/score-preview?filter=attention' : '',
        },
        {
          key: 'valid-calls',
          icon: CheckCircle2,
          label: '有效通话',
          value: todayRecording.completed,
          detail: '今日已完成记录',
          tone: 'green',
          to: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '',
          defaultVisible: false,
        },
        {
          key: 'open-follow-ups',
          icon: Clock3,
          label: '待回访',
          value: n(followUps.open_follow_ups),
          detail: '未完成回访任务',
          tone: 'amber',
          to: canViewWorkCenter ? '/admin/work-center?queue=follow' : '',
          defaultVisible: false,
        },
        {
          key: 'today-new-leads',
          icon: UserRound,
          label: '今日新增线索',
          value: n(summary?.today_new_leads),
          detail: '今日进入系统的线索',
          tone: 'blue',
          to: canViewLeadsManage ? '/admin/leads?created_today=1' : '',
          defaultVisible: false,
        },
        {
          key: 'enrolled',
          icon: CheckCircle2,
          label: '已报名',
          value: enrolledTotal,
          detail: '当前确认报名',
          tone: 'green',
          to: canViewLeadsManage ? '/admin/leads?stage=已报名' : '',
          defaultVisible: false,
        },
      ];
    }
    return [
      {
        key: 'total-students',
        icon: Users,
        label: '总线索量',
        value: totalStudents,
        detail: '当前全库学生',
        tone: 'blue',
        to: canViewLeadsManage ? '/admin/leads' : '',
      },
      {
        key: 'contacted-students',
        icon: Phone,
        label: '已联系学生',
        value: contactedStudents,
        detail: '排除未联系与无效',
        tone: 'green',
      },
      {
        key: 'a-level',
        icon: TrendingUp,
        label: 'A级意向',
        value: aLevelTotal,
        detail: '当前重点跟进',
        tone: 'amber',
        to: canViewLeadsManage ? dashboardLeadUrls.allA : '',
      },
      {
        key: 'global-enrolled',
        icon: CheckCircle2,
        label: '已报名',
        value: enrolledTotal,
        detail: '当前确认报名',
        tone: 'green',
        to: canViewLeadsManage ? '/admin/leads?stage=已报名' : '',
      },
      {
        key: 'global-follow-ups',
        icon: Clock3,
        label: '待回访',
        value: n(followUps.open_follow_ups),
        detail: '未完成回访任务',
        tone: 'amber',
        to: canViewWorkCenter ? '/admin/work-center?queue=follow' : '',
        defaultVisible: false,
      },
      {
        key: 'global-unassigned',
        icon: UserRound,
        label: '可分配线索',
        value: availableUnassigned,
        detail: '未分配且仍需跟进',
        tone: 'amber',
        to: canViewLeadsManage ? dashboardLeadUrls.availableUnassigned : '',
        defaultVisible: false,
      },
    ];
  }, [
    aLevelTotal,
    attentionAgents.length,
    availableUnassigned,
    canViewLeadsManage,
    canViewReportCenter,
    canViewScorePreview,
    canViewWorkCenter,
    contactedStudents,
    enrolledTotal,
    followUps.open_follow_ups,
    scoreItems.length,
    scope,
    summary?.today_new_leads,
    todayA,
    todayRecording.completed,
    todayRecording.pending,
    totalCalls,
    totalStudents,
  ]);
  const metricPreferences = useDashboardCardPreferences({
    cards: metricCards,
    scope: `mobile-metrics-${scope}`,
    userKey: user?.id || user?.username || 'admin',
  });
  const visibleMetricCards = metricPreferences.visibleCards.filter((card) => hasDashboardCardData({ ...card, loading, hideWhenEmpty: card.defaultVisible === false }));

  const actionCards = useMemo(() => {
    const cards = [
      {
        key: 'overdue-follow-ups',
        icon: Clock3,
        title: '逾期回访',
        detail: `逾期 ${n(followUps.overdue_follow_ups)} 条 · 未完成 ${n(followUps.open_follow_ups)} 条`,
        tone: n(followUps.overdue_follow_ups) > 0 ? 'red' : 'green',
        to: canViewWorkCenter ? '/admin/work-center?queue=follow' : '',
        value: n(followUps.overdue_follow_ups),
      },
      {
        key: 'missing-phone',
        icon: AlertTriangle,
        title: '无电话数据',
        detail: `${n(students.missing_phone_tasks)} 条线索没有可拨电话`,
        tone: n(students.missing_phone_tasks) > 0 ? 'red' : 'green',
        to: canViewLeadsManage ? dashboardLeadUrls.missingPhone : '',
        value: n(students.missing_phone_tasks),
      },
      {
        key: 'pending-dials',
        icon: Clock3,
        title: '待完成拨号',
        detail: `今日 ${todayRecording.pending} 通 · 本月 ${monthRecording.pending} 通`,
        tone: todayRecording.pending > 0 ? 'amber' : 'green',
        to: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '',
        value: todayRecording.pending,
      },
      {
        key: 'legacy-records',
        icon: Clock3,
        title: '历史未回填',
        detail: `今日 ${todayRecording.legacy} 通 · 本月 ${monthRecording.legacy} 通`,
        tone: 'gray',
        to: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '',
        value: todayRecording.legacy + monthRecording.legacy,
      },
      {
        key: 'invalid-leads',
        icon: ListFilter,
        title: '无效线索',
        detail: `${n(students.invalid_total)} 条，查看无效原因和回收`,
        tone: n(students.invalid_total) > 0 ? 'blue' : 'gray',
        to: canViewLeadsManage ? leadFilterUrl({ status: '无效' }) : '',
        value: n(students.invalid_total),
      },
    ];
    if (canViewSystemSettings) {
      cards.push({
        key: 'system-health',
        icon: Settings,
        title: '系统运行',
        detail: `通知失败 ${n(business.notification_failures_7d)} · 锁定账号 ${n(business.locked_users)}`,
        tone: n(business.notification_failures_7d) > 0 || n(business.locked_users) > 0 ? 'amber' : 'green',
        to: '/admin/settings',
        value: n(business.notification_failures_7d) + n(business.locked_users),
      });
    }
    return cards;
  }, [
    business.locked_users,
    business.notification_failures_7d,
    canViewLeadsManage,
    canViewReportCenter,
    canViewSystemSettings,
    canViewWorkCenter,
    followUps.open_follow_ups,
    followUps.overdue_follow_ups,
    monthRecording.legacy,
    monthRecording.pending,
    students.invalid_total,
    students.missing_phone_tasks,
    todayRecording.legacy,
    todayRecording.pending,
  ]);
  const actionPreferences = useDashboardCardPreferences({
    cards: actionCards,
    scope: 'mobile-actions',
    userKey: user?.id || user?.username || 'admin',
  });
  const visibleActionCards = actionPreferences.visibleCards.filter((card) => loading || card.value > 0);

  return (
    <AdminLayout isMobile sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="min-w-0 flex-1 bg-slate-100 dark:bg-gray-950">
        <PageHeader
          title="移动管理"
          isMobile
          onMenuClick={() => setSidebarOpen(true)}
          actionsClassName="flex items-center gap-1"
        >
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="使用说明"
            title="使用说明"
            className="rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <HelpCircle className="h-5 w-5 text-gray-500" />
          </button>
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
          <section className="rounded-panel border border-blue-100 bg-blue-50/70 px-4 py-4 dark:border-blue-900/60 dark:bg-blue-950/20">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-gray-950 dark:text-white">移动指挥中心</div>
                <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">
                  {scope === 'today' ? '今日执行、异常和坐席状态集中查看。' : '全库资产、联系覆盖和招生沉淀集中查看。'}
                </p>
              </div>
              <div
                role="group"
                aria-label="移动管理数据范围"
                className="flex shrink-0 items-center gap-0.5 rounded-panel border border-blue-100 bg-white/80 p-1 dark:border-blue-900/60 dark:bg-gray-800/80"
              >
                <button
                  type="button"
                  aria-pressed={scope === 'today'}
                  onClick={() => setScope('today')}
                  className={`inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-2xs font-semibold transition ${scope === 'today' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                >
                  <CalendarDays className="h-3 w-3" />
                  今日
                </button>
                <button
                  type="button"
                  aria-pressed={scope === 'all'}
                  onClick={() => setScope('all')}
                  className={`inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-2xs font-semibold transition ${scope === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                >
                  <Globe2 className="h-3 w-3" />
                  全局
                </button>
              </div>
            </div>
          </section>

          <section className={`rounded-panel border px-4 py-4 ${hasCritical ? metricTone.amber : metricTone.green}`}>
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

          <section aria-label="核心指标">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">核心指标</h2>
                <div className="mt-0.5 text-2xs text-gray-500 dark:text-gray-400">无数据卡片会自动隐藏，可在更多中调整展示</div>
              </div>
              <DashboardCardPicker
                cards={metricCards}
                hiddenKeys={metricPreferences.hiddenKeys}
                onToggle={metricPreferences.toggleCard}
                onReset={metricPreferences.resetCards}
              />
            </div>
            {visibleMetricCards.length === 0 ? (
              <div className="rounded-panel border border-dashed border-emerald-200 bg-emerald-50/60 px-4 py-6 text-center text-xs text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-300">
                暂无可展示指标
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {visibleMetricCards.map(({ key, ...card }) => (
                  <MetricCard key={key} {...card} value={loading ? '-' : card.value} />
                ))}
              </div>
            )}
          </section>

          {scope === 'all' && (
            <MobileGlobalOverview summary={summary} enrolledTotal={enrolledTotal} loading={loading} />
          )}

          <section className="rounded-panel border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">异常处理</h2>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">无异常时自动收起，可在更多中调整展示</div>
              </div>
              <div className="flex items-center gap-2">
                <DashboardCardPicker
                  cards={actionCards.map((card) => ({ ...card, label: card.title, hasData: card.value > 0 }))}
                  hiddenKeys={actionPreferences.hiddenKeys}
                  onToggle={actionPreferences.toggleCard}
                  onReset={actionPreferences.resetCards}
                />
                {canViewSystemSettings && (
                  <Link to="/admin/settings" className="text-xs text-blue-600 dark:text-blue-300">
                    数据质量
                  </Link>
                )}
              </div>
            </div>
            {visibleActionCards.length === 0 ? (
              <div className="rounded-panel border border-dashed border-emerald-200 bg-emerald-50/60 px-3 py-5 text-center text-xs text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-300">
                暂无需要处理的异常
              </div>
            ) : (
              <div className="space-y-2">
                {visibleActionCards.map((card) => (
                  <QuickAction key={card.key} icon={card.icon} title={card.title} detail={card.detail} tone={card.tone} to={card.to} />
                ))}
              </div>
            )}
          </section>

          {canViewScorePreview && (
            <section className="rounded-panel border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
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
                <div className="rounded-panel bg-gray-50 px-3 py-6 text-center text-sm text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                  暂无话务员评分数据
                </div>
              )}
            </section>
          )}

          <section className="grid grid-cols-2 gap-3">
            {canViewLeadsManage && (
              <>
                <QuickAction
                  icon={Search}
                  title="查学生"
                  detail="姓名、电话、学校"
                  tone="blue"
                  to="/admin/leads"
                />
                <QuickAction
                  icon={Eye}
                  title="A 级线索"
                  detail={`当前 ${n(summary?.a_level)} 条重点线索`}
                  tone="green"
                  to={leadFilterUrl({ intent: 'A' })}
                />
              </>
            )}
            {canViewAccountManage && (
              <QuickAction
                icon={UserRound}
                title="话务员"
                detail="账号与任务"
                tone="gray"
                to="/admin/agents"
              />
            )}
            {canViewReportCenter && (
              <QuickAction
                icon={BarChart3}
                title="报表"
                detail="趋势和通话"
                tone="gray"
                to="/admin/report-center"
              />
            )}
          </section>
        </div>
      </main>
      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        role={user?.is_super_admin ? 'super_admin' : 'admin'}
      />
    </AdminLayout>
  );
}
