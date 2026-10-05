import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Globe2,
  HelpCircle,
  PhoneCall,
  RefreshCw,
  TrendingUp,
  UserPlus,
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
import AdminCommandBoard from './dashboard/AdminCommandBoard';

const EMPTY_ACTION_DATA = {
  helpRequests: [],
  followUps: [],
  visits: [],
  scoreItems: [],
  staleAItems: [],
};

function dashboardResultFailed(result) {
  if (result?.status !== 'fulfilled') return true;
  const body = result.value?.data;
  return body && Object.prototype.hasOwnProperty.call(body, 'code') && body.code !== 0;
}

function responseData(result, fallback) {
  if (dashboardResultFailed(result)) return fallback;
  return result.value?.data?.data ?? fallback;
}

function GlobalOverview({ summary, enrolledTotal, loading, summaryError, enrollmentError }) {
  const cells = [
    ['全盘线索', summary?.total_students, '当前全部学生', summaryError],
    ['已联系学生', summary?.contacted, '排除未联系与无效', summaryError],
    ['A级意向', summary?.a_level, '当前重点跟进', summaryError],
    ['已报名', enrolledTotal, '当前确认报名', enrollmentError || summaryError],
  ];
  return (
    <section data-testid="admin-global-overview" className="rounded-panel border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-panel-dark">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700"><div><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">全局数据总览</h2><p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">全库实时口径</p></div><span className="rounded-full bg-blue-50 px-2 py-1 text-3xs font-semibold text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">实时同步</span></div>
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 dark:divide-slate-700 sm:grid-cols-4 sm:divide-y-0">{cells.map(([label, value, detail, error]) => <div key={label} className="px-4 py-3"><div className="text-2xs font-medium text-slate-500 dark:text-slate-400">{label}</div><div className="mt-1 text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">{loading ? '—' : error ? '--' : Number(value || 0).toLocaleString()}</div><div className="mt-0.5 text-3xs text-slate-400 dark:text-slate-500">{detail}</div></div>)}</div>
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
  const [stageStats, setStageStats] = useState({});
  const [enrollmentData, setEnrollmentData] = useState(null);
  const [funnelData, setFunnelData] = useState(null);
  const [quality, setQuality] = useState(null);
  const [dailyOps, setDailyOps] = useState(null);
  const [dailyOpsSavingKey, setDailyOpsSavingKey] = useState('');
  const [notifyFails, setNotifyFails] = useState(0);
  const [notifyFailsError, setNotifyFailsError] = useState(false);
  const [actionData, setActionData] = useState(EMPTY_ACTION_DATA);
  const [trendData, setTrendData] = useState(null);

  useEffect(() => { toastRef.current = toast; }, [toast]);

  const canViewScorePreview = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.scorePreview);
  const canViewReportCenter = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.reportCenter);
  const canViewAuditLogs = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.auditLogs);
  const canViewWorkCenter = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.workCenter);
  const canViewLeadsManage = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.leadsManage);
  const canReviewDailyOps = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.governanceReview);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const requests = [
      api.get('/admin/daily-ops'),
      api.get('/stats/dashboard-all'),
      canViewLeadsManage ? api.get('/students', { params: { need_help: '1', page_size: 100 } }) : Promise.resolve({ data: { data: { list: [] } } }),
      api.get('/follow-ups', { params: { is_completed: false, page_size: 100 } }),
      api.get('/visits', { params: { page_size: 100 } }),
      canViewScorePreview ? api.get('/admin/agent-score-preview', { params: { daily_call_target: 30 } }) : Promise.resolve({ data: { data: { items: [] } } }),
      api.get('/admin/stale-a', { params: { days: 3 } }),
      api.get('/admin/data-quality'),
      canViewReportCenter ? api.get('/stats/trend') : Promise.resolve({ data: { data: null } }),
    ];
    Promise.allSettled(requests).then((results) => {
      if (cancelled) return;
      const coreData = responseData(results[1], null);
      const nextErrors = {
        dailyOps: dashboardResultFailed(results[0]),
        summary: dashboardResultFailed(results[1]),
        regions: dashboardResultFailed(results[1]),
        visitsSummary: dashboardResultFailed(results[1]),
        stages: dashboardResultFailed(results[1]),
        enrollment: dashboardResultFailed(results[1]),
        funnel: dashboardResultFailed(results[1]),
        helpRequests: dashboardResultFailed(results[2]),
        followUps: dashboardResultFailed(results[3]),
        visits: dashboardResultFailed(results[4]),
        scoreItems: dashboardResultFailed(results[5]),
        staleAItems: dashboardResultFailed(results[6]),
        quality: dashboardResultFailed(results[7]),
        trend: dashboardResultFailed(results[8]),
      };
      const helpData = responseData(results[2], { list: [] });
      const followUpData = responseData(results[3], { list: [] });
      const visitsData = responseData(results[4], { list: [] });
      const scoreData = responseData(results[5], { items: [] });
      const staleAData = responseData(results[6], []);
      if (!nextErrors.dailyOps) setDailyOps(responseData(results[0], null));
      if (!nextErrors.summary) setSummary(coreData?.summary ?? null);
      if (!nextErrors.regions) setStats(Array.isArray(coreData?.sources) ? coreData.sources : []);
      if (!nextErrors.stages) setStageStats(coreData?.stages ?? {});
      if (!nextErrors.enrollment) setEnrollmentData(coreData?.summary ? { total: coreData.summary.enrolled_total ?? 0 } : null);
      if (!nextErrors.funnel) setFunnelData(coreData?.funnel ?? null);
      if (!nextErrors.quality) setQuality(responseData(results[7], null));
      if (!nextErrors.trend) setTrendData(responseData(results[8], null));
      setActionData((current) => ({
        helpRequests: nextErrors.helpRequests ? current.helpRequests : (Array.isArray(helpData?.list) ? helpData.list : []),
        followUps: nextErrors.followUps ? current.followUps : (Array.isArray(followUpData?.list) ? followUpData.list : []),
        visits: nextErrors.visits ? current.visits : (Array.isArray(visitsData?.list) ? visitsData.list : []),
        scoreItems: nextErrors.scoreItems ? current.scoreItems : (Array.isArray(scoreData?.items) ? scoreData.items : []),
        staleAItems: nextErrors.staleAItems ? current.staleAItems : (Array.isArray(staleAData) ? staleAData : []),
      }));
      setErrors(nextErrors);
      if (Object.values(nextErrors).some(Boolean)) toastRef.current?.error?.('部分管理指标加载失败，已保留可用数据');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [canViewLeadsManage, canViewReportCenter, canViewScorePreview, refreshKey]);

  useEffect(() => {
    if (!canViewAuditLogs) { setNotifyFails(0); setNotifyFailsError(false); return undefined; }
    api.get('/admin/operation-logs?action=通知失败&days=7').then((response) => {
      if (response.data?.code !== undefined && response.data.code !== 0) throw new Error(response.data.msg || '通知失败指标加载失败');
      setNotifyFails(response.data.data?.total ?? 0); setNotifyFailsError(false);
    }).catch(() => setNotifyFailsError(true));
    return undefined;
  }, [canViewAuditLogs, refreshKey]);

  const retryDashboard = useCallback(() => { setLoading(true); setRefreshKey((value) => value + 1); }, []);
  const refreshDailyOps = useCallback(async () => { const response = await api.get('/admin/daily-ops'); setDailyOps(response.data.data || null); }, []);
  const markDailyOpsItem = useCallback(async (item, status) => {
    if (!canReviewDailyOps || !item?.key) return;
    const savingKey = `${item.key}:${status}`;
    setDailyOpsSavingKey(savingKey);
    try { await api.post('/admin/daily-ops/reviews', { key: item.key, status, count: item.count || 0 }); toastRef.current?.success?.('已记录运营闭环'); await refreshDailyOps(); } catch (error) { toastRef.current?.error?.(`记录运营闭环失败：${getApiErrorMessage(error)}`); } finally { setDailyOpsSavingKey(''); }
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
  }), [actionData, canViewLeadsManage, canViewReportCenter, canViewScorePreview, canViewWorkCenter, notifyFails, quality?.students?.missing_phone_tasks, user?.is_super_admin]);

  const availableUnassigned = summary?.available_unassigned ?? quality?.students?.unassigned_active ?? 0;
  const todayA = summary?.today_a ?? 0;
  const todayCalls = summary?.today_calls ?? quality?.calls?.today?.total_calls ?? 0;
  const enrolledTotal = summary?.enrolled_total ?? enrollmentData?.total ?? 0;
  const totalStudents = summary?.total_students ?? 0;
  const contactedStudents = summary?.contacted ?? 0;
  const aLevelTotal = summary?.a_level ?? 0;
  const todayNewLeads = summary?.today_new_leads ?? 0;
  const validCalls = quality?.calls?.today?.recorded_calls ?? 0;
  const openFollowUps = quality?.follow_ups?.open_follow_ups ?? 0;

  const todayMetricCards = [
    { key: 'today-calls', label: '今日呼出', value: todayCalls, detail: '拨号日志实时统计', icon: BarChart3, iconTone: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300', to: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '', error: errors.summary && errors.quality },
    { key: 'valid-calls', label: '有效通话', value: validCalls, detail: '已完成记录', icon: PhoneCall, iconTone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300', to: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '', error: errors.quality },
    { key: 'open-follow-ups', label: '待回访', value: openFollowUps, detail: '未完成回访任务', icon: Clock3, iconTone: 'bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300', to: canViewWorkCenter ? '/admin/work-center?queue=follow' : '', error: errors.quality },
    { key: 'today-new-leads', label: '今日新增线索', value: todayNewLeads, detail: `可分配有效线索 ${availableUnassigned}`, icon: UserPlus, iconTone: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-300', to: canViewLeadsManage ? dashboardLeadUrls.availableUnassigned : '', error: errors.summary },
    { key: 'today-a', label: '今日新增 A', value: todayA, detail: '今日首次升为 A 级', icon: TrendingUp, iconTone: 'bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300', to: canViewLeadsManage ? dashboardLeadUrls.todayA : '', error: errors.summary },
    { key: 'enrolled', label: '已报名', value: enrolledTotal, detail: '当前确认报名', icon: CheckCircle2, iconTone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300', to: canViewLeadsManage ? '/admin/leads?stage=已报名' : '', error: errors.summary && errors.enrollment },
    { key: 'available-unassigned', label: '待分配线索', value: availableUnassigned, detail: '未分配且仍需跟进', icon: Users, iconTone: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300', to: canViewLeadsManage ? dashboardLeadUrls.availableUnassigned : '', error: errors.summary, defaultVisible: false },
    { key: 'backlog-follow-ups', label: '积压任务', value: openFollowUps, detail: '等待继续处理的任务', icon: Clock3, iconTone: 'bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300', to: canViewWorkCenter ? '/admin/work-center' : '', error: errors.quality, defaultVisible: false },
  ];
  const globalMetricCards = [
    { key: 'total-students', label: '总线索量', value: totalStudents, detail: '当前全库学生', icon: Users, iconTone: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300', to: canViewLeadsManage ? '/admin/leads' : '', error: errors.summary },
    { key: 'contacted-students', label: '已联系学生', value: contactedStudents, detail: '排除未联系与无效', icon: PhoneCall, iconTone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300', error: errors.summary },
    { key: 'a-level', label: 'A级意向', value: aLevelTotal, detail: '当前重点跟进', icon: TrendingUp, iconTone: 'bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300', to: canViewLeadsManage ? dashboardLeadUrls.allA : '', error: errors.summary },
    { key: 'global-enrolled', label: '已报名', value: enrolledTotal, detail: '当前确认报名', icon: CheckCircle2, iconTone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300', to: canViewLeadsManage ? '/admin/leads?stage=已报名' : '', error: errors.summary && errors.enrollment },
    { key: 'global-follow-ups', label: '待回访', value: openFollowUps, detail: '未完成回访任务', icon: Clock3, iconTone: 'bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300', to: canViewWorkCenter ? '/admin/work-center?queue=follow' : '', error: errors.quality, defaultVisible: false },
    { key: 'global-unassigned', label: '可分配线索', value: availableUnassigned, detail: '未分配且仍需跟进', icon: UserPlus, iconTone: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-300', to: canViewLeadsManage ? dashboardLeadUrls.availableUnassigned : '', error: errors.summary, defaultVisible: false },
  ];
  const metricCards = scope === 'today' ? todayMetricCards : globalMetricCards;

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} compactSidebar={!isMobile}>
      <main data-testid="admin-dashboard-scroll" className="flex h-screen min-w-0 flex-1 flex-col overflow-y-auto bg-surface-page scroll-thin dark:bg-gray-950">
        <PageHeader title="招生指挥中心" isMobile={isMobile} onMenuClick={() => setSidebarOpen(true)}>
          <div className="hidden items-center gap-2 border-l border-slate-200 pl-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400 lg:flex"><span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}</span><span>星期{['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()]}</span></div>
          <div role="group" aria-label="仪表盘数据范围" className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"><button type="button" aria-pressed={scope === 'today'} onClick={() => setScope('today')} className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold ${scope === 'today' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}><CalendarDays className="h-3.5 w-3.5" />今日运营</button><button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')} className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold ${scope === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}><Globe2 className="h-3.5 w-3.5" />全局总览</button></div>
          <button type="button" onClick={retryDashboard} disabled={loading} aria-label="刷新仪表盘" title="刷新仪表盘" className="rounded-lg text-slate-500 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-400"><RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={() => setHelpOpen(true)} aria-label="使用说明" title="使用说明" className="rounded-lg text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-400"><HelpCircle className="h-5 w-5" /></button>
        </PageHeader>
        <div className="w-full space-y-4 p-4 pb-16 lg:p-5 xl:space-y-5 xl:p-7 xl:pb-16">
          <section className="flex flex-col justify-between gap-2 rounded-panel border border-slate-200 bg-white px-4 py-3 shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-panel-dark sm:flex-row sm:items-center lg:px-5"><div><div className="text-sm font-bold text-slate-900 dark:text-slate-100">招生指挥中心</div><p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">{scope === 'today' ? '聚焦今日执行、运营闭环与高风险待办。' : '聚焦全库资产、联系覆盖与招生转化沉淀。'} 点击指标即可进入处理页面。</p></div><div className="flex items-center gap-2 text-2xs font-semibold text-blue-600 dark:text-blue-400"><span className="h-2 w-2 rounded-full bg-emerald-500" />{loading ? '正在同步数据…' : '数据已同步'}</div></section>
          {scope === 'all' && <GlobalOverview summary={summary} enrolledTotal={enrolledTotal} loading={loading} summaryError={errors.summary} enrollmentError={errors.enrollment} />}
          <AdminCommandBoard actionItems={actionItems} dailyOps={dailyOps} quality={quality} scoreItems={actionData.scoreItems} stageStats={stageStats} funnelData={funnelData} stats={stats} trendData={trendData} loading={loading} errors={errors} onRetry={retryDashboard} retrying={loading} canViewLeadsManage={canViewLeadsManage} canViewWorkCenter={canViewWorkCenter} canViewReportCenter={canViewReportCenter} metricCards={metricCards} availableUnassigned={availableUnassigned} totalStudents={totalStudents} aLevelTotal={aLevelTotal} enrolledTotal={enrolledTotal} todayNewLeads={todayNewLeads} dailyOpsLoading={loading} dailyOpsError={errors.dailyOps} dailyOpsSavingKey={dailyOpsSavingKey} canReviewDailyOps={canReviewDailyOps} onMarkDailyOps={markDailyOpsItem} actionItemsError={Boolean(errors.helpRequests || errors.followUps || errors.visits || errors.scoreItems || errors.staleAItems || errors.quality || notifyFailsError)} cardPreferenceUserKey={user?.id || user?.username || 'admin'} cardPreferenceScope={scope} />
        </div>
      </main>
      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} role={user?.is_super_admin ? 'super_admin' : 'admin'} />
    </AdminLayout>
  );
}

export default function AdminDash() {
  const isMobile = useIsMobile();
  if (isMobile) return <AdminMobileDash />;
  return <AdminDesktopDash isMobile={isMobile} />;
}
