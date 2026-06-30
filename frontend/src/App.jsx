import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import useIsMobile from './hooks/useIsMobile';
import useSyncManager from './hooks/useSyncManager';
import useErrorMonitor from './hooks/useErrorMonitor';
import ErrorBoundary from './components/ErrorBoundary';
import ConnectionStatus from './components/ConnectionStatus';
import { setGlobalToast } from './api';
import { useEffect } from 'react';

const Login = lazy(() => import('./pages/Login'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const AdminDash = lazy(() => import('./pages/admin/AdminDash'));
const AdminWorkCenter = lazy(() => import('./pages/admin/AdminWorkCenter'));
const AgentScorePreview = lazy(() => import('./pages/admin/AgentScorePreview'));
const LeadsManage = lazy(() => import('./pages/admin/LeadsManage'));
const StudentDetail = lazy(() => import('./pages/admin/StudentDetail'));
const LeadGovernance = lazy(() => import('./pages/admin/LeadGovernance'));
const AgentWork = lazy(() => import('./pages/agent/AgentWork'));
const AgentManage = lazy(() => import('./pages/admin/AgentManage'));
const SystemSettings = lazy(() => import('./pages/admin/SystemSettings'));
const InvalidStudentReclaim = lazy(() => import('./pages/admin/InvalidStudentReclaim'));
const ReportCenter = lazy(() => import('./pages/admin/ReportCenter'));
const DistributeBySchools = lazy(() => import('./pages/admin/DistributeBySchools'));
const MobileHome = lazy(() => import('./pages/mobile/MobileHome'));
const MobileStudentDetail = lazy(() => import('./pages/mobile/MobileStudentDetail'));
const MobileCallForm = lazy(() => import('./pages/mobile/MobileCallForm'));

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

function Protected({ children, role, superAdmin = false }) {
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
  const { loading } = useAuth();
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
          path="/admin/work-center"
          element={
            <Protected role="admin">
              <RouteError><AdminWorkCenter /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/score-preview"
          element={
            <Protected role="admin">
              <RouteError><AgentScorePreview /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/leads"
          element={
            <Protected role="admin">
              <RouteError><LeadsManage /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/leads/:id"
          element={
            <Protected role="admin">
              <RouteError><StudentDetail /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/governance"
          element={
            <Protected role="admin">
              <RouteError><LeadGovernance /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/recycle-center"
          element={
            <Protected role="admin">
              <Navigate to="/admin/governance" replace />
            </Protected>
          }
        />
        <Route
          path="/admin/recycle"
          element={
            <Protected role="admin">
              <Navigate to="/admin/governance" replace />
            </Protected>
          }
        />
        <Route
          path="/admin/agents"
          element={
            <Protected role="admin">
              <RouteError><AgentManage /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/report-center"
          element={
            <Protected role="admin">
              <RouteError><ReportCenter /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/report"
          element={
            <Protected role="admin">
              <Navigate to="/admin/report-center?tab=summary" replace />
            </Protected>
          }
        />
        <Route
          path="/admin/trend"
          element={
            <Protected role="admin">
              <Navigate to="/admin/report-center?tab=trend" replace />
            </Protected>
          }
        />
        <Route
          path="/admin/call-volume"
          element={
            <Protected role="admin">
              <Navigate to="/admin/report-center?tab=call-volume" replace />
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
          path="/admin/invalid-reclaim"
          element={
            <Protected role="admin">
              <RouteError><InvalidStudentReclaim /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/distribute"
          element={
            <Protected role="admin">
              <RouteError><DistributeBySchools /></RouteError>
            </Protected>
          }
        />
        <Route
          path="/admin/distribute-by-schools"
          element={
            <Protected role="admin">
              <RouteError><DistributeBySchools /></RouteError>
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
        <Route
          path="/mobile/call/:id"
          element={
            <Protected role="agent">
              <RouteError><MobileCallForm /></RouteError>
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
