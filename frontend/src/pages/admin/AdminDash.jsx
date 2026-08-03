import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, GraduationCap, HelpCircle, TrendingUp, Users } from 'lucide-react';
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

function AdminDesktopDash({ isMobile }) {
  const { user } = useAuth();
  const toast = useToast();
  const toastRef = useRef(toast);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [loading, setLoading] = useState(true);
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
      api.get('/stats/sources'),
      api.get('/stats/dashboard-summary'),
      api.get('/visits/summary'),
      api.get('/stats/stages'),
      api.get('/students/enrolled?page_size=1'),
      api.get('/stats/funnel'),
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
      const nextErrors = {
        dailyOps: dashboardResultFailed(results[0]),
        regions: dashboardResultFailed(results[1]),
        summary: dashboardResultFailed(results[2]),
        visitsSummary: dashboardResultFailed(results[3]),
        stages: dashboardResultFailed(results[4]),
        enrollment: dashboardResultFailed(results[5]),
        funnel: dashboardResultFailed(results[6]),
        helpRequests: dashboardResultFailed(results[7]),
        followUps: dashboardResultFailed(results[8]),
        visits: dashboardResultFailed(results[9]),
        scoreItems: dashboardResultFailed(results[10]),
        staleAItems: dashboardResultFailed(results[11]),
        quality: dashboardResultFailed(results[12]),
      };
      const dailyOpsData = responseData(results[0], null);
      const sourceStats = responseData(results[1], []);
      const dashboardSummary = responseData(results[2], null);
      const visitsSummaryData = responseData(results[3], null);
      const stagesData = responseData(results[4], {});
      const enrollmentSummary = responseData(results[5], null);
      const funnelSummary = responseData(results[6], null);
      const helpData = responseData(results[7], { list: [] });
      const followUpData = responseData(results[8], { list: [] });
      const visitsData = responseData(results[9], { list: [] });
      const scoreData = responseData(results[10], { items: [] });
      const staleAData = responseData(results[11], []);
      const qualityData = responseData(results[12], null);

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

  const metricCards = [
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
      label: '今日呼出',
      value: todayCalls,
      detail: '拨号日志实时统计',
      icon: BarChart3,
      tone: 'amber',
      to: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '',
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
  ].filter((card) => !card.hidden);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
      <main
        data-testid="admin-dashboard-scroll"
        className="flex h-screen min-w-0 flex-1 flex-col overflow-y-auto bg-gray-50 scroll-thin dark:bg-gray-950"
      >
        <PageHeader
          title="仪表盘"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        >
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
          <AdminMetricStrip cards={metricCards} loading={loading} onRetry={retryDashboard} />
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
