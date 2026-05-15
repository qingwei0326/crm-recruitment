import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import AdminDash from './pages/admin/AdminDash';
import LeadsManage from './pages/admin/LeadsManage';
import AgentWork from './pages/agent/AgentWork';
import AgentManage from './pages/admin/AgentManage';
import Report from './pages/admin/Report';
import TrendReport from './pages/admin/TrendReport';
import CallVolumeQuery from './pages/admin/CallVolumeQuery';

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
  if (loading)
    return (
      <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>
    );

  return (
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
        path="/agent"
        element={
          <Protected role="agent">
            <AgentWork />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
