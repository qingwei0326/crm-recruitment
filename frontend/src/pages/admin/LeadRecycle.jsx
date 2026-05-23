import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import { formatDateTime } from '../../utils';
import {
  CheckSquare,
  Square,
  Loader2,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  RefreshCw,
  ArrowRightLeft,
  Inbox,
  Users,
  LayoutDashboard,
  ListFilter,
  BarChart3,
  TrendingUp,
  Search,
  Settings,
} from 'lucide-react';

const inputCls =
  'w-full px-3 py-2.5 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400';

function getApiErrorMessage(error) {
  return error?.response?.data?.detail || error?.response?.data?.msg || error?.message || '加载失败';
}

export default function LeadRecycle() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [days, setDays] = useState(3);
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/stale-students', { params: { days } });
      setStudents(res.data.data || []);
      setSelected(new Set());
    } catch {
      setStudents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  const closeSidebar = () => setSidebarOpen(false);

  const toggleSel = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === students.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(students.map((item) => item.student_id)));
  };

  const handleRecycle = async () => {
    if (selected.size === 0) return;
    setActionLoading(true);
    try {
      const res = await api.post('/admin/stale-reassign', {
        student_ids: [...selected],
        mode: 'recycle',
      });
      if (res.data.code === 0) {
        await fetchStudents();
      } else {
        alert(res.data.msg || '操作失败');
      }
    } catch (e) {
      alert(getApiErrorMessage(e));
    } finally {
      setActionLoading(false);
    }
  };

  const SidebarNav = () => (
    <>
      <div className="flex items-center justify-between px-4 h-14 border-b dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <ArrowRightLeft className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">线索回收</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{user?.name}</div>
          </div>
        </div>
        {isMobile && (
          <button onClick={closeSidebar} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        )}
      </div>
      <nav className="p-3 space-y-1">
        <Link to="/admin" onClick={closeSidebar} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium">
          <LayoutDashboard className="w-4 h-4" /> 仪表盘
        </Link>
        <Link to="/admin/leads" onClick={closeSidebar} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium">
          <ListFilter className="w-4 h-4" /> 学生管理
        </Link>
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
          <ArrowRightLeft className="w-4 h-4" /> 线索回收
        </div>
        <Link to="/admin/agents" onClick={closeSidebar} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium">
          <Users className="w-4 h-4" /> 话务员管理
        </Link>
        <Link to="/admin/report" onClick={closeSidebar} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium">
          <BarChart3 className="w-4 h-4" /> 汇总报表
        </Link>
        <Link to="/admin/trend" onClick={closeSidebar} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium">
          <TrendingUp className="w-4 h-4" /> 趋势报表
        </Link>
        <Link to="/admin/call-volume" onClick={closeSidebar} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium">
          <Search className="w-4 h-4" /> 通电量查询
        </Link>
        <Link to="/admin/settings" onClick={closeSidebar} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium">
          <Settings className="w-4 h-4" /> 系统设置
        </Link>
      </nav>
      <div className="mt-auto p-3 border-t dark:border-gray-700 space-y-1">
        <button onClick={toggle} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg">
          {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}{' '}
          {dark ? '亮色模式' : '暗色模式'}
        </button>
        <button onClick={logout} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
          <LogOut className="w-4 h-4" /> 退出登录
        </button>
      </div>
    </>
  );

  const selectedCount = selected.size;

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-900">
      {isMobile && sidebarOpen && <div className="fixed inset-0 bg-black/40 z-40" onClick={closeSidebar} />}
      <aside className={`${isMobile ? 'fixed inset-y-0 left-0 z-50 shadow-2xl transform transition-transform ' + (sidebarOpen ? 'translate-x-0' : '-translate-x-full') : ''} w-60 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col`}>
        <SidebarNav />
      </aside>
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setSidebarOpen(true)}>
                <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">线索回收</h2>
          </div>
          <button onClick={toggle} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
        </header>

        <div className="p-4 lg:p-6 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">天数</label>
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls}>
                  {[3, 7, 14, 30].map((d) => (
                    <option key={d} value={d}>
                      {d}天
                    </option>
                  ))}
                </select>
              </div>
              <button onClick={fetchStudents} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm">
                <RefreshCw className="w-4 h-4" /> 查询
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
              <div className="text-sm text-gray-600 dark:text-gray-400">已分配且超过 {days} 天无回访记录的线索</div>
              <button onClick={toggleAll} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                {selectedCount === students.length && students.length > 0 ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}
                全选
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500">
                  <tr>
                    <th className="px-4 py-3 w-10" />
                    <th className="px-4 py-3 text-left">姓名</th>
                    <th className="px-4 py-3 text-left">地区</th>
                    <th className="px-4 py-3 text-left">意向</th>
                    <th className="px-4 py-3 text-left">状态</th>
                    <th className="px-4 py-3 text-left">坐席</th>
                    <th className="px-4 py-3 text-left">分配时间</th>
                    <th className="px-4 py-3 text-left">最后活动</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : students.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-gray-400">暂无数据</td>
                    </tr>
                  ) : (
                    students.map((item) => (
                      <tr key={item.student_id} className="hover:bg-gray-50 dark:hover:bg-gray-900/20">
                        <td className="px-4 py-3">
                          <button onClick={() => toggleSel(item.student_id)}>
                            {selected.has(item.student_id) ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-gray-400" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{item.name}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{item.region || '-'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{item.intent_level || '-'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{item.status || '-'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{item.agent_name || '-'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatDateTime(item.assigned_at)}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatDateTime(item.last_activity_at || item.assigned_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedCount > 0 && (
            <div className="sticky bottom-4 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-lg p-4 flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                已选 {selectedCount} 条
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <button onClick={handleRecycle} disabled={actionLoading} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Inbox className="w-4 h-4" />}
                  回收到总名单
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
