import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

const Login = lazy(() => import('./pages/Login'));
const AdminDash = lazy(() => import('./pages/admin/AdminDash'));
const LeadsManage = lazy(() => import('./pages/admin/LeadsManage'));
const AgentWork = lazy(() => import('./pages/agent/AgentWork'));
const AgentManage = lazy(() => import('./pages/admin/AgentManage'));
const Report = lazy(() => import('./pages/admin/Report'));
const TrendReport = lazy(() => import('./pages/admin/TrendReport'));
const CallVolumeQuery = lazy(() => import('./pages/admin/CallVolumeQuery'));
const SystemSettings = lazy(() => import('./pages/admin/SystemSettings'));

function LoadingScreen() {
  return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>;
}

function Protected({ children, role }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/agent'} replace />;
  }
  return children;
}

function Guest({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/agent'} replace />;
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
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
