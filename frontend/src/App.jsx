import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import useIsMobile from './hooks/useIsMobile';
import useSyncManager from './hooks/useSyncManager';
import useErrorMonitor from './hooks/useErrorMonitor';
import ErrorBoundary from './components/ErrorBoundary';
import ConnectionStatus from './components/ConnectionStatus';
import AssistantOverlay from './components/assistant/AssistantOverlay';
import { AssistantProvider } from './context/AssistantContext';
import { setGlobalToast } from './api';
import lazyWithRetry from './utils/lazyWithRetry';
import { useEffect } from 'react';
import { ADMIN_PAGE_PERMISSIONS, canAccessAdminPage } from './adminPermissions';

const Login = lazyWithRetry(() => import('./pages/Login'));
const ChangePassword = lazyWithRetry(() => import('./pages/ChangePassword'));
const AdminDash = lazyWithRetry(() => import('./pages/admin/AdminDash'));
const AdminWorkCenter = lazyWithRetry(() => import('./pages/admin/AdminWorkCenter'));
const AgentScorePreview = lazyWithRetry(() => import('./pages/admin/AgentScorePreview'));
const LeadsManage = lazyWithRetry(() => import('./pages/admin/LeadsManage'));
const GlobalSearch = lazyWithRetry(() => import('./pages/admin/GlobalSearch'));
const StudentDetail = lazyWithRetry(() => import('./pages/admin/StudentDetail'));
const LeadGovernance = lazyWithRetry(() => import('./pages/admin/LeadGovernance'));
const AssignmentBatchReview = lazyWithRetry(() => import('./pages/admin/AssignmentBatchReview'));
const AgentWork = lazyWithRetry(() => import('./pages/agent/AgentWork'));
const AgentManage = lazyWithRetry(() => import('./pages/admin/AgentManage'));
const HandoverCenter = lazyWithRetry(() => import('./pages/admin/HandoverCenter'));
const SystemSettings = lazyWithRetry(() => import('./pages/admin/SystemSettings'));
const SeasonArchive = lazyWithRetry(() => import('./pages/admin/SeasonArchive'));
const InvalidStudentReclaim = lazyWithRetry(() => import('./pages/admin/InvalidStudentReclaim'));
const ReportCenter = lazyWithRetry(() => import('./pages/admin/ReportCenter'));
const DistributeBySchools = lazyWithRetry(() => import('./pages/admin/DistributeBySchools'));
const AuditLogs = lazyWithRetry(() => import('./pages/admin/AuditLogs'));
const HomeVisitManage = lazyWithRetry(() => import('./pages/admin/HomeVisitManage'));
const CampusVisitManage = lazyWithRetry(() => import('./pages/admin/CampusVisitManage'));
const EnrollmentSettlement = lazyWithRetry(() => import('./pages/admin/EnrollmentSettlement'));
const AdminAssistant = lazyWithRetry(() => import('./pages/admin/AdminAssistant'));
const MobileHome = lazyWithRetry(() => import('./pages/mobile/MobileHome'));
const MobileStudentDetail = lazyWithRetry(() => import('./pages/mobile/MobileStudentDetail'));

function LoadingScreen() {
  return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>;
}

// Per-route ErrorBoundary wrapper - 单页面崩溃不影响其他页面
function RouteError({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function defaultRouteFor(user, isMobile) {
  if (!user) return '/login';
  if (user.role === 'admin') return '/admin';
  if (user.role === 'agent') return isMobile ? '/mobile' : '/agent';
  return '/login';
}

function Protected({ children, role, superAdmin = false, permission }) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  if (!user) return <Navigate to="/login" replace />;
  // 首次登录 / 被重置密码：强制先改密，任何受保护页都先拦到改密页
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  if (role && user.role !== role) {
    return <Navigate to={defaultRouteFor(user, isMobile)} replace />;
  }
  if (superAdmin && !user.is_super_admin) {
    return <Navigate to={defaultRouteFor(user, isMobile)} replace />;
  }
  if (permission && !canAccessAdminPage(user, permission)) {
    return <Navigate to={defaultRouteFor(user, isMobile)} replace />;
  }
  return children;
}

function Guest({ children }) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  if (user) return <Navigate to={defaultRouteFor(user, isMobile)} replace />;
  return children;
}

// 已登录即可访问（改密页本身不能用 Protected，否则强制改密会自我重定向死循环）
function LoggedIn({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { loading, user } = useAuth();
  const { isOnline } = useSyncManager();

  // 启动全局错误监控
  useErrorMonitor();

  // 设置全局 toast 用于 API 错误提示
  useEffect(() => {
    // 延迟获取 toast 函数，避免循环依赖
    const toastEl = document.querySelector('[data-toast]');
    if (toastEl) {
      setGlobalToast((msg) => {
        toastEl.dispatchEvent(new CustomEvent('toast-error', { detail: msg }));
      });
    }
  }, []);

  if (loading) return <LoadingScreen />;

  return (
    <AssistantProvider active={Boolean(user?.role === 'admin' && user?.is_super_admin)}>
    <ErrorBoundary>
    <ConnectionStatus isOnline={isOnline} />
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route
          path="/login"
          element={
            <Guest>
              <RouteError><Login /></RouteError>
            </Guest>
          }
        />
        <Route
          path="/change-password"
          element={
            <LoggedIn>
              <RouteError><ChangePassword /></RouteError>
            </LoggedIn>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected role="admin">
              <RouteError><AdminDash /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/dashboard"
          element={
            <Protected role="admin">
              <Navigate to="/admin" replace />
            </Protected>
          }
        />
        <Route
          path="/admin/work-center"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.workCenter}>
              <RouteError><AdminWorkCenter /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/score-preview"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.scorePreview}>
              <RouteError><AgentScorePreview /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/search"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.leadsManage}>
              <RouteError><GlobalSearch /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/leads"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.leadsManage}>
              <RouteError><LeadsManage /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/leads/:id"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.leadsManage}>
              <RouteError><StudentDetail /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/governance"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.leadGovernance}>
              <RouteError><LeadGovernance /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/assignment-batches/:batchId/review"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.auditLogs}>
              <RouteError><AssignmentBatchReview /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/recycle-center"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.leadGovernance}>
              <Navigate to="/admin/governance" replace />
            </Protected>
          }
        />
        <Route
          path="/admin/recycle"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.leadGovernance}>
              <Navigate to="/admin/governance" replace />
            </Protected>
          }
        />
        <Route
          path="/admin/agents"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.accountManage}>
              <RouteError><AgentManage /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/handovers"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.accountManage}>
              <RouteError><HandoverCenter /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/report-center"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.reportCenter}>
              <RouteError><ReportCenter /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/report"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.reportCenter}>
              <Navigate to="/admin/report-center?tab=summary" replace />
            </Protected>
          }
        />
        <Route
          path="/admin/trend"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.reportCenter}>
              <Navigate to="/admin/report-center?tab=trend" replace />
            </Protected>
          }
        />
        <Route
          path="/admin/call-volume"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.reportCenter}>
              <Navigate to="/admin/report-center?tab=call-volume" replace />
            </Protected>
          }
        />
        <Route
          path="/admin/assistant"
          element={
            <Protected role="admin" superAdmin>
              <RouteError><AdminAssistant /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <Protected role="admin" superAdmin>
              <RouteError><SystemSettings /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/season-archive"
          element={
            <Protected role="admin" superAdmin>
              <RouteError><SeasonArchive /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/invalid-reclaim"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.invalidReclaim}>
              <RouteError><InvalidStudentReclaim /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/distribute"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.schoolDistribution}>
              <RouteError><DistributeBySchools /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/distribute-by-schools"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.schoolDistribution}>
              <RouteError><DistributeBySchools /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/audit-logs"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.auditLogs}>
              <RouteError><AuditLogs /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/home-visits"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.homeVisits}>
              <RouteError><HomeVisitManage /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/campus-visits"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.campusVisits}>
              <RouteError><CampusVisitManage /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/enrollment-settlement"
          element={
            <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.enrollmentSettlement}>
              <RouteError><EnrollmentSettlement /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/agent"
          element={
            <Protected role="agent">
              <RouteError><AgentWork /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/mobile"
          element={
            <Protected role="agent">
              <RouteError><MobileHome /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/mobile/student/:id"
          element={
            <Protected role="agent">
              <RouteError><MobileStudentDetail /></RouteError>
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
    <AssistantOverlay />
    </ErrorBoundary>
    </AssistantProvider>
  );
}
