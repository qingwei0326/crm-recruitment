import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  Globe2,
  GraduationCap,
  HelpCircle,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import HelpModal from '../../components/HelpModal';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import { getApiErrorMessage } from '../../utils';
import {
  ADMIN_OPERATION_PERMISSIONS,
  ADMIN_PAGE_PERMISSIONS,
  canAccessAdminPage,
  canPerformAdminOperation,
} from '../../adminPermissions';
import { buildDashboardActions, dashboardLeadUrls } from './adminWorkflow';
import AdminMobileDash from './AdminMobileDash';
import AdminPipelineOverview, { AdminMetricStrip } from './dashboard/AdminPipelineOverview';
import AdminOpsRail from './dashboard/AdminOpsRail';

const EMPTY_ACTION_DATA = {
  helpRequests: [],
  followUps: [],
  visits: [],
  scoreItems: [],
  staleAItems: [],
};

function responseData(result, fallback) {
  if (dashboardResultFailed(result)) return fallback;
  return result.value?.data?.data ?? fallback;
}

function dashboardResultFailed(result) {
  if (result?.status !== 'fulfilled') return true;
  const body = result.value?.data;
  return body && Object.prototype.hasOwnProperty.call(body, 'code') && body.code !== 0;
}

function GlobalOverview({ summary, enrolledTotal, loading, summaryError, enrollmentError }) {
  const cells = [
    {
      label: '全盘线索',
      value: summary?.total_students,
      detail: '当前全部学生',
      error: summaryError,
    },
    {
      label: '已联系学生',
      value: summary?.contacted,
      detail: '排除未联系与无效',
      error: summaryError,
    },
    {
      label: 'A级意向',
      value: summary?.a_level,
      detail: '当前重点跟进',
      error: summaryError,
    },
    {
      label: '已报名',
      value: enrolledTotal,
      detail: '当前确认报名',
      error: enrollmentError || summaryError,
    },
  ];

  return (
    <section
      data-testid="admin-global-overview"
      className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div>
          <h2 className="text-xs font-bold tracking-wide text-gray-900 dark:text-gray-100">全局数据总览</h2>
          <p className="mt-0.5 text-[11px] text-gray-400">与今日执行指标分开显示，口径为当前全库</p>
        </div>
        <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          实时口径
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-gray-100 sm:grid-cols-4 sm:divide-y-0 dark:divide-gray-800">
        {cells.map((cell) => (
          <div key={cell.label} className="min-w-0 px-4 py-3">
            <div className="truncate text-[11px] font-medium text-gray-500 dark:text-gray-400">{cell.label}</div>
            <div className="mt-1 text-xl font-black tabular-nums text-gray-950 dark:text-white">
              {loading ? '-' : cell.error ? '--' : Number(cell.value || 0).toLocaleString()}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-gray-400">{cell.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AdminDesktopDash({ isMobile }) {
  const { user } = useAuth();
  const toast = useToast();
  const toastRef = useRef(toast);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState('today');
  const [refreshKey, setRefreshKey] = useState(0);
  const [errors, setErrors] = useState({});
  const [stats, setStats] = useState([]);
  const [summary, setSummary] = useState(null);
  const [visitSummary, setVisitSummary] = useState(null);
  const [stageStats, setStageStats] = useState({});
  const [enrollmentData, setEnrollmentData] = useState(null);
  const [funnelData, setFunnelData] = useState(null);
  const [quality, setQuality] = useState(null);
  const [dailyOps, setDailyOps] = useState(null);
  const [dailyOpsSavingKey, setDailyOpsSavingKey] = useState('');
  const [notifyFails, setNotifyFails] = useState(0);
  const [notifyFailsError, setNotifyFailsError] = useState(false);
  const [actionData, setActionData] = useState(EMPTY_ACTION_DATA);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const canViewScorePreview = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.scorePreview);
  const canViewReportCenter = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.reportCenter);
  const canViewAuditLogs = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.auditLogs);
  const canViewWorkCenter = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.workCenter);
  const canViewLeadsManage = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.leadsManage);
  const canReviewDailyOps = canPerformAdminOperation(
    user,
    ADMIN_OPERATION_PERMISSIONS.governanceReview,
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const requests = [
      api.get('/admin/daily-ops'),
      // 核心统计统一走一个只读快照接口，降低首页首屏请求数量。
      api.get('/stats/dashboard-all'),
      canViewLeadsManage
        ? api.get('/students', { params: { need_help: '1', page_size: 100 } })
        : Promise.resolve({ data: { data: { list: [] } } }),
      api.get('/follow-ups', { params: { is_completed: false, page_size: 100 } }),
      api.get('/visits', { params: { page_size: 100 } }),
      canViewScorePreview
        ? api.get('/admin/agent-score-preview', { params: { daily_call_target: 30 } })
        : Promise.resolve({ data: { data: { items: [] } } }),
      api.get('/admin/stale-a', { params: { days: 3 } }),
      api.get('/admin/data-quality'),
    ];

    Promise.allSettled(requests).then((results) => {
      if (cancelled) return;
      const coreResult = results[1];
      const coreData = responseData(coreResult, null);
      const nextErrors = {
        dailyOps: dashboardResultFailed(results[0]),
        regions: dashboardResultFailed(coreResult),
        summary: dashboardResultFailed(coreResult),
        visitsSummary: dashboardResultFailed(coreResult),
        stages: dashboardResultFailed(coreResult),
        enrollment: dashboardResultFailed(coreResult),
        funnel: dashboardResultFailed(coreResult),
        helpRequests: dashboardResultFailed(results[2]),
        followUps: dashboardResultFailed(results[3]),
        visits: dashboardResultFailed(results[4]),
        scoreItems: dashboardResultFailed(results[5]),
        staleAItems: dashboardResultFailed(results[6]),
        quality: dashboardResultFailed(results[7]),
      };
      const dailyOpsData = responseData(results[0], null);
      const sourceStats = Array.isArray(coreData?.sources) ? coreData.sources : [];
      const dashboardSummary = coreData?.summary ?? null;
      const visitsSummaryData = coreData?.visits ?? null;
      const stagesData = coreData?.stages ?? {};
      const enrollmentSummary = dashboardSummary
        ? { total: dashboardSummary.enrolled_total ?? 0 }
        : null;
      const funnelSummary = coreData?.funnel ?? null;
      const helpData = responseData(results[2], { list: [] });
      const followUpData = responseData(results[3], { list: [] });
      const visitsData = responseData(results[4], { list: [] });
      const scoreData = responseData(results[5], { items: [] });
      const staleAData = responseData(results[6], []);
      const qualityData = responseData(results[7], null);

      if (!nextErrors.dailyOps) setDailyOps(dailyOpsData);
      if (!nextErrors.regions) setStats(Array.isArray(sourceStats) ? sourceStats : []);
      if (!nextErrors.summary) setSummary(dashboardSummary);
      if (!nextErrors.visitsSummary) setVisitSummary(visitsSummaryData);
      if (!nextErrors.stages) setStageStats(stagesData || {});
      if (!nextErrors.enrollment) setEnrollmentData(enrollmentSummary);
      if (!nextErrors.funnel) setFunnelData(funnelSummary);
      if (!nextErrors.quality) setQuality(qualityData);
      setActionData((current) => ({
        helpRequests: nextErrors.helpRequests
          ? current.helpRequests
          : (Array.isArray(helpData?.list) ? helpData.list : []),
        followUps: nextErrors.followUps
          ? current.followUps
          : (Array.isArray(followUpData?.list) ? followUpData.list : []),
        visits: nextErrors.visits
          ? current.visits
          : (Array.isArray(visitsData?.list) ? visitsData.list : []),
        scoreItems: nextErrors.scoreItems
          ? current.scoreItems
          : (Array.isArray(scoreData?.items) ? scoreData.items : []),
        staleAItems: nextErrors.staleAItems
          ? current.staleAItems
          : (Array.isArray(staleAData) ? staleAData : []),
      }));
      setErrors(nextErrors);
      if (Object.values(nextErrors).some(Boolean)) {
        toastRef.current?.error('部分管理指标加载失败，已保留可用数据');
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [canViewLeadsManage, canViewScorePreview, refreshKey]);

  useEffect(() => {
    if (!canViewAuditLogs) {
      setNotifyFails(0);
      setNotifyFailsError(false);
      return;
    }
    api.get('/admin/operation-logs?action=通知失败&days=7')
      .then((response) => {
        if (response.data?.code !== undefined && response.data.code !== 0) {
          throw new Error(response.data.msg || '通知失败指标加载失败');
        }
        setNotifyFails(response.data.data?.total ?? 0);
        setNotifyFailsError(false);
      })
      .catch(() => setNotifyFailsError(true));
  }, [canViewAuditLogs, refreshKey]);

  const retryDashboard = useCallback(() => {
    setLoading(true);
    setRefreshKey((value) => value + 1);
  }, []);

  const refreshDailyOps = useCallback(async () => {
    const response = await api.get('/admin/daily-ops');
    setDailyOps(response.data.data || null);
  }, []);

  const markDailyOpsItem = useCallback(async (item, status) => {
    if (!canReviewDailyOps || !item?.key) return;
    const savingKey = `${item.key}:${status}`;
    setDailyOpsSavingKey(savingKey);
    try {
      await api.post('/admin/daily-ops/reviews', {
        key: item.key,
        status,
        count: item.count || 0,
      });
      toastRef.current?.success?.('已记录运营闭环');
      await refreshDailyOps();
    } catch (error) {
      toastRef.current?.error(`记录运营闭环失败：${getApiErrorMessage(error)}`);
    } finally {
      setDailyOpsSavingKey('');
    }
  }, [canReviewDailyOps, refreshDailyOps]);

  const actionItems = useMemo(() => buildDashboardActions({
    helpCount: actionData.helpRequests.length,
    followUps: actionData.followUps,
    visits: actionData.visits,
    scoreItems: actionData.scoreItems,
    missingPhoneCount: quality?.students?.missing_phone_tasks ?? 0,
    staleAItems: actionData.staleAItems,
    notifyFails,
    canViewSystemSettings: Boolean(user?.is_super_admin),
    canViewWorkCenter,
    canViewLeadsManage,
    canViewScorePreview,
    canViewReportCenter,
  }), [
    actionData,
    canViewLeadsManage,
    canViewReportCenter,
    canViewScorePreview,
    canViewWorkCenter,
    notifyFails,
    quality?.students?.missing_phone_tasks,
    user?.is_super_admin,
  ]);

  const availableUnassigned = summary?.available_unassigned
    ?? quality?.students?.unassigned_active
    ?? 0;
  const todayA = summary?.today_a ?? 0;
  const todayCalls = summary?.today_calls ?? quality?.calls?.today?.total_calls ?? 0;
  const enrolledTotal = summary?.enrolled_total ?? enrollmentData?.total ?? 0;
  const totalStudents = summary?.total_students ?? 0;
  const contactedStudents = summary?.contacted ?? 0;
  const aLevelTotal = summary?.a_level ?? 0;

  const todayMetricCards = [
    {
      label: '今日呼出',
      value: todayCalls,
      detail: '拨号日志实时统计',
      icon: BarChart3,
      tone: 'amber',
      to: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '',
      error: errors.summary && errors.quality,
    },
    {
      label: '今日新增 A',
      value: todayA,
      detail: '今日首次升为 A 级',
      icon: TrendingUp,
      tone: 'green',
      to: canViewLeadsManage ? dashboardLeadUrls.todayA : '',
      hidden: !canViewLeadsManage,
      error: errors.summary,
    },
    {
      label: '可分配有效线索',
      value: availableUnassigned,
      detail: '未分配且仍在跟进',
      icon: Users,
      tone: 'blue',
      to: canViewLeadsManage ? dashboardLeadUrls.availableUnassigned : '',
      hidden: !canViewLeadsManage,
      error: errors.summary && errors.quality,
    },
    {
      label: '报名总数',
      value: enrolledTotal,
      detail: '当前已确认报名',
      icon: GraduationCap,
      tone: 'violet',
      to: canViewLeadsManage ? '/admin/leads?stage=已报名' : '',
      error: errors.summary && errors.enrollment,
    },
  ];

  const globalMetricCards = [
    {
      label: '总线索量',
      value: totalStudents,
      detail: '当前全库学生',
      icon: Users,
      tone: 'blue',
      to: canViewLeadsManage ? '/admin/leads' : '',
      error: errors.summary,
    },
    {
      label: '已联系学生',
      value: contactedStudents,
      detail: '排除未联系与无效',
      icon: BarChart3,
      tone: 'green',
      error: errors.summary,
    },
    {
      label: 'A级意向',
      value: aLevelTotal,
      detail: '当前重点跟进',
      icon: TrendingUp,
      tone: 'amber',
      to: canViewLeadsManage ? dashboardLeadUrls.allA : '',
      error: errors.summary,
    },
    {
      label: '报名总数',
      value: enrolledTotal,
      detail: '当前已确认报名',
      icon: GraduationCap,
      tone: 'violet',
      to: canViewLeadsManage ? '/admin/leads?stage=已报名' : '',
      error: errors.summary && errors.enrollment,
    },
  ];

  const metricCards = (scope === 'today' ? todayMetricCards : globalMetricCards)
    .filter((card) => !card.hidden);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
      <main
        data-testid="admin-dashboard-scroll"
        className="flex h-screen min-w-0 flex-1 flex-col overflow-y-auto bg-slate-100 scroll-thin dark:bg-gray-950"
      >
        <PageHeader
          title="招生指挥中心"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        >
          <div
            role="group"
            aria-label="仪表盘数据范围"
            className="flex items-center gap-0.5 rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-800"
          >
            <button
              type="button"
              aria-pressed={scope === 'today'}
              onClick={() => setScope('today')}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition ${scope === 'today' ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-700 dark:text-blue-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              今日运营
            </button>
            <button
              type="button"
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition ${scope === 'all' ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-700 dark:text-blue-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              <Globe2 className="h-3.5 w-3.5" />
              全局总览
            </button>
          </div>
          <button
            type="button"
            onClick={retryDashboard}
            disabled={loading}
            aria-label="刷新仪表盘"
            title="刷新仪表盘"
            className="rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-blue-400"
          >
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="使用说明"
            title="使用说明"
            className="rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-blue-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-blue-400"
          >
            <HelpCircle className="h-5 w-5" />
          </button>
        </PageHeader>

        <div className="w-full space-y-5 p-4 pb-16 lg:p-5 lg:pb-16 xl:space-y-6 xl:p-8 xl:pb-16">
          <section className="flex flex-col justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-4 dark:border-blue-900/60 dark:bg-blue-950/20 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <div className="text-sm font-bold text-gray-950 dark:text-white">招生指挥中心</div>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-600 dark:text-gray-300">
                {scope === 'today' ? '聚焦今日执行、运营闭环与高风险待办。' : '聚焦全库资产、联系覆盖与招生转化沉淀。'}
                {' '}点击指标可进入对应的处理页面。
              </p>
            </div>
            <div className="shrink-0 text-[11px] font-medium text-blue-700 dark:text-blue-300">
              {loading ? '正在同步数据…' : '数据已同步'}
            </div>
          </section>
          <AdminMetricStrip cards={metricCards} loading={loading} onRetry={retryDashboard} />
          <GlobalOverview
            summary={summary}
            enrolledTotal={enrolledTotal}
            loading={loading}
            summaryError={errors.summary}
            enrollmentError={errors.enrollment}
          />
          <div
            data-testid="admin-dashboard-columns"
            className="grid w-full grid-cols-1 items-start gap-5 lg:grid-cols-12 xl:gap-6"
          >
            <AdminPipelineOverview
              stageStats={stageStats}
              funnelData={funnelData}
              stats={stats}
              canViewLeadsManage={canViewLeadsManage}
              errors={{
                stages: errors.stages,
                funnel: errors.funnel,
                regions: errors.regions,
              }}
              onRetry={retryDashboard}
              retrying={loading}
              className="w-full lg:col-span-7"
            />
            <AdminOpsRail
              dailyOps={dailyOps}
              dailyOpsLoading={loading}
              dailyOpsError={errors.dailyOps}
              dailyOpsSavingKey={dailyOpsSavingKey}
              canReviewDailyOps={canReviewDailyOps}
              onMarkDailyOps={markDailyOpsItem}
              actionItems={actionItems}
              actionItemsError={Boolean(
                errors.helpRequests
                || errors.followUps
                || errors.visits
                || errors.scoreItems
                || errors.staleAItems
                || errors.quality
                || notifyFailsError
              )}
              loading={loading}
              enrollmentData={enrollmentData}
              visitSummary={visitSummary}
              quality={quality}
              overviewErrors={{
                quality: errors.quality,
                enrollment: errors.enrollment,
                visits: errors.visitsSummary,
              }}
              onRetry={retryDashboard}
              canViewLeadsManage={canViewLeadsManage}
              canViewReportCenter={canViewReportCenter}
              className="w-full lg:col-span-5"
            />
          </div>
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

export default function AdminDash() {
  const isMobile = useIsMobile();
  if (isMobile) return <AdminMobileDash />;
  return <AdminDesktopDash isMobile={isMobile} />;
}
