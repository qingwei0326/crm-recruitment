import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import useIsMobile from './hooks/useIsMobile';

const Login = lazy(() => import('./pages/Login'));
const AdminDash = lazy(() => import('./pages/admin/AdminDash'));
const LeadsManage = lazy(() => import('./pages/admin/LeadsManage'));
const StudentDetail = lazy(() => import('./pages/admin/StudentDetail'));
const LeadRecycle = lazy(() => import('./pages/admin/LeadRecycle'));
const AgentWork = lazy(() => import('./pages/agent/AgentWork'));
const AgentManage = lazy(() => import('./pages/admin/AgentManage'));
const Report = lazy(() => import('./pages/admin/Report'));
const TrendReport = lazy(() => import('./pages/admin/TrendReport'));
const CallVolumeQuery = lazy(() => import('./pages/admin/CallVolumeQuery'));
const SystemSettings = lazy(() => import('./pages/admin/SystemSettings'));
const MobileHome = lazy(() => import('./pages/mobile/MobileHome'));
const MobileStudentDetail = lazy(() => import('./pages/mobile/MobileStudentDetail'));
const MobileCallForm = lazy(() => import('./pages/mobile/MobileCallForm'));

function LoadingScreen() {
  return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>;
}

function defaultRouteFor(user, isMobile) {
  if (!user) return '/login';
  if (user.role === 'admin') return '/admin';
  if (user.role === 'agent') return isMobile ? '/mobile' : '/agent';
  return '/login';
}

function Protected({ children, role }) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
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

export default function App() {
  const { loading } = useAuth();
  if (loading) return <LoadingScreen />;

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route
          path="/login"
          element={
            <Guest>
              <Login />
            </Guest>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected role="admin">
              <AdminDash />
            </Protected>
          }
        />
        <Route
          path="/admin/leads"
          element={
            <Protected role="admin">
              <LeadsManage />
            </Protected>
          }
        />
        <Route
          path="/admin/leads/:id"
          element={
            <Protected role="admin">
              <StudentDetail />
            </Protected>
          }
        />
        <Route
          path="/admin/recycle"
          element={
            <Protected role="admin">
              <LeadRecycle />
            </Protected>
          }
        />
        <Route
          path="/admin/agents"
          element={
            <Protected role="admin">
              <AgentManage />
            </Protected>
          }
        />
        <Route
          path="/admin/report"
          element={
            <Protected role="admin">
              <Report />
            </Protected>
          }
        />
        <Route
          path="/admin/trend"
          element={
            <Protected role="admin">
              <TrendReport />
            </Protected>
          }
        />
        <Route
          path="/admin/call-volume"
          element={
            <Protected role="admin">
              <CallVolumeQuery />
            </Protected>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <Protected role="admin">
              <SystemSettings />
            </Protected>
          }
        />
        <Route
          path="/agent"
          element={
            <Protected role="agent">
              <AgentWork />
            </Protected>
          }
        />
        <Route
          path="/mobile"
          element={
            <Protected role="agent">
              <MobileHome />
            </Protected>
          }
        />
        <Route
          path="/mobile/student/:id"
          element={
            <Protected role="agent">
              <MobileStudentDetail />
            </Protected>
          }
        />
        <Route
          path="/mobile/call/:id"
          element={
            <Protected role="agent">
              <MobileCallForm />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
