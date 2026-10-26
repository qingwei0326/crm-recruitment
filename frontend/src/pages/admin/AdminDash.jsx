import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, HelpCircle, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import HelpModal from '../../components/HelpModal';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import {
  ADMIN_PAGE_PERMISSIONS,
  canAccessAdminPage,
} from '../../adminPermissions';
import { dashboardLeadUrls } from './adminWorkflow';
import AdminMobileDash from './AdminMobileDash';
import KeyNumbers from './dashboard/KeyNumbers';
import TeamProgressPanel from './dashboard/TeamProgressPanel';
import TodayTodoList from './dashboard/TodayTodoList';

function dashboardResultFailed(result) {
  if (result?.status !== 'fulfilled') return true;
  const body = result.value?.data;
  return body && Object.prototype.hasOwnProperty.call(body, 'code') && body.code !== 0;
}

function responseData(result, fallback) {
  if (dashboardResultFailed(result)) return fallback;
  return result.value?.data?.data ?? fallback;
}

// The desktop home: a row of key numbers, the one list of things waiting today,
// and team progress. Analysis (stages, funnel, regions, trends) lives in 报表中心.
function AdminDesktopDash({ isMobile }) {
  const { user } = useAuth();
  const toast = useToast();
  const toastRef = useRef(toast);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [errors, setErrors] = useState({});
  const [summary, setSummary] = useState(null);
  const [dailyOps, setDailyOps] = useState(null);

  useEffect(() => { toastRef.current = toast; }, [toast]);

  const canViewScorePreview = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.scorePreview);
  const canViewReportCenter = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.reportCenter);
  const canViewLeadsManage = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.leadsManage);
  const canViewSettlement = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.enrollmentSettlement);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      api.get('/admin/daily-ops'),
      api.get('/stats/dashboard-all'),
    ]).then(([dailyOpsResult, coreResult]) => {
      if (cancelled) return;
      const nextErrors = {
        dailyOps: dashboardResultFailed(dailyOpsResult),
        summary: dashboardResultFailed(coreResult),
      };
      if (!nextErrors.dailyOps) setDailyOps(responseData(dailyOpsResult, null));
      if (!nextErrors.summary) setSummary(responseData(coreResult, null)?.summary ?? null);
      setErrors(nextErrors);
      if (nextErrors.dailyOps || nextErrors.summary) {
        toastRef.current?.error?.('部分管理指标加载失败，已保留可用数据');
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const retryDashboard = useCallback(() => { setLoading(true); setRefreshKey((value) => value + 1); }, []);

  const pendingReports = Number(
    dailyOps?.items?.find((item) => item.key === 'pending_enrollment_reports')?.count || 0,
  );
  const cells = [
    {
      key: 'today-calls',
      label: '今日呼出',
      value: summary?.today_calls,
      detail: '拨号记录实时统计',
      to: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '',
    },
    {
      key: 'available-unassigned',
      label: '可分配线索',
      value: summary?.available_unassigned,
      detail: '未分配且仍需跟进',
      to: canViewLeadsManage ? dashboardLeadUrls.availableUnassigned : '',
    },
    {
      key: 'a-level',
      label: 'A 级意向',
      value: summary?.a_level,
      detail: `今日新增 ${Number(summary?.today_a || 0)}`,
      to: canViewLeadsManage ? dashboardLeadUrls.allA : '',
    },
    {
      key: 'enrolled',
      label: '已报名',
      value: summary?.enrolled_total,
      detail: pendingReports > 0 ? `另有 ${pendingReports} 条待确认` : '已确认的报名',
      highlight: pendingReports > 0,
      to: pendingReports > 0 && canViewSettlement
        ? '/admin/enrollment-settlement'
        : canViewLeadsManage ? '/admin/leads?stage=已报名' : '',
    },
    {
      key: 'total-students',
      label: '总线索',
      value: summary?.total_students,
      detail: `今日新增 ${Number(summary?.today_new_leads || 0)}`,
      to: canViewLeadsManage ? '/admin/leads' : '',
    },
  ];

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} compactSidebar={!isMobile}>
      <main data-testid="admin-dashboard-scroll" className="flex h-screen min-w-0 flex-1 flex-col overflow-y-auto bg-surface-page scroll-thin dark:bg-gray-950">
        <PageHeader title="招生指挥中心" isMobile={isMobile} onMenuClick={() => setSidebarOpen(true)}>
          <button type="button" onClick={retryDashboard} disabled={loading} aria-label="刷新仪表盘" title="刷新仪表盘" className="rounded-lg text-slate-500 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-400"><RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={() => setHelpOpen(true)} aria-label="使用说明" title="使用说明" className="rounded-lg text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-400"><HelpCircle className="h-5 w-5" /></button>
        </PageHeader>
        <div className="w-full space-y-4 p-4 pb-16 lg:p-5 xl:space-y-5 xl:p-7 xl:pb-16">
          <KeyNumbers cells={cells} loading={loading} error={errors.summary} />
          <TodayTodoList dailyOps={dailyOps} loading={loading} error={errors.dailyOps} onRetry={retryDashboard} />
          <TeamProgressPanel refreshKey={refreshKey} canViewLeadsManage={canViewLeadsManage} />
          {(canViewReportCenter || canViewScorePreview) && (
            <div className="flex flex-wrap justify-end gap-4 text-2xs font-semibold">
              {canViewScorePreview && <Link to="/admin/score-preview" className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">坐席评分 <ArrowRight className="h-3 w-3" /></Link>}
              {canViewReportCenter && <Link to="/admin/report-center" className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">完整报表（漏斗、区域、趋势） <ArrowRight className="h-3 w-3" /></Link>}
            </div>
          )}
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
