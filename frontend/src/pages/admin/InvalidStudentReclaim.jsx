/**
 * 无效线索回收管理页面
 *
 * 功能：
 * 1. 分页列出所有标记为「无效」的线索，并显示无效原因
 * 2. 勾选线索，选择话务员，批量回收并重新分配（状态重置为「未联系」）
 *
 * 技术栈与全站一致：Tailwind + lucide-react + 统一的 api 实例（不使用 antd）。
 * 接口：GET /admin/invalid-students、GET /admin/agents、POST /admin/reclaim-students
 */

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
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Users,
  LayoutDashboard,
  ListFilter,
  ArrowRightLeft,
  BarChart3,
  TrendingUp,
  Search,
  Settings,
} from 'lucide-react';

const inputCls =
  'px-3 py-2.5 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400';

function getApiErrorMessage(error) {
  return error?.response?.data?.detail || error?.response?.data?.msg || error?.message || '加载失败';
}

const PAGE_SIZE = 20;

export default function InvalidStudentReclaim() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchInvalid = async (targetPage = 1) => {
    setLoading(true);
    try {
      const res = await api.get('/admin/invalid-students', {
        params: { page: targetPage, page_size: PAGE_SIZE },
      });
      if (res.data.code === 0) {
        const data = res.data.data || {};
        setStudents(data.list || []);
        setTotal(data.total || 0);
        setPage(targetPage);
      } else {
        alert(res.data.msg || '加载失败');
      }
    } catch (e) {
      alert(getApiErrorMessage(e));
      setStudents([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await api.get('/admin/agents');
      if (res.data.code === 0) setAgents(res.data.data || []);
    } catch (e) {
      console.error('加载话务员列表失败', e);
    }
  };

  useEffect(() => {
    fetchInvalid(1);
    fetchAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeSidebar = () => setSidebarOpen(false);

  const toggleSel = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const allCurrentSelected = students.length > 0 && students.every((s) => selected.has(s.id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allCurrentSelected) {
      students.forEach((s) => next.delete(s.id));
    } else {
      students.forEach((s) => next.add(s.id));
    }
    setSelected(next);
  };

  const handleReclaim = async () => {
    if (selected.size === 0) {
      alert('请先勾选要回收的线索');
      return;
    }
    if (!selectedAgentId) {
      alert('请选择要分配的话务员');
      return;
    }
    const agentName = agents.find((a) => String(a.id) === String(selectedAgentId))?.name || '该话务员';
    if (!window.confirm(`确定回收 ${selected.size} 条无效线索并重新分配给「${agentName}」吗？`)) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await api.post('/admin/reclaim-students', {
        student_ids: [...selected],
        agent_id: Number(selectedAgentId),
      });
      if (res.data.code === 0) {
        const d = res.data.data || {};
        alert(`成功回收 ${d.reclaimed_count ?? selected.size} 条线索，已分配给 ${d.agent_name || agentName}`);
        setSelected(new Set());
        setSelectedAgentId('');
        // 回收后当前页可能减少，回到第一页重新拉取
        fetchInvalid(1);
      } else {
        alert(res.data.msg || '回收失败');
      }
    } catch (e) {
      alert(getApiErrorMessage(e));
    } finally {
      setActionLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const SidebarNav = () => (
    <>
      <div className="flex items-center justify-between px-4 h-14 border-b dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <RotateCcw className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">无效线索回收</div>
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
        <Link to="/admin/recycle" onClick={closeSidebar} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium">
          <ArrowRightLeft className="w-4 h-4" /> 线索回收
        </Link>
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
          <RotateCcw className="w-4 h-4" /> 无效线索回收
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
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">无效线索回收</h2>
          </div>
          <button onClick={toggle} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
        </header>

        <div className="p-4 lg:p-6 space-y-4">
          {/* 工具栏 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 flex flex-col lg:flex-row lg:items-center gap-3">
            <button onClick={() => fetchInvalid(page)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
              <RefreshCw className="w-4 h-4" /> 刷新
            </button>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              已选 <span className="font-semibold text-blue-600 dark:text-blue-300">{selected.size}</span> 条
            </div>
            <div className="flex-1" />
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <span className="text-sm text-gray-600 dark:text-gray-400">分配给</span>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className={`${inputCls} min-w-[160px]`}
              >
                <option value="">选择话务员</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleReclaim}
                disabled={actionLoading || selected.size === 0 || !selectedAgentId}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                回收并重新分配
              </button>
            </div>
          </div>

          {/* 列表 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
              <div className="text-sm text-gray-600 dark:text-gray-400">共 {total} 条无效线索</div>
              <button onClick={toggleAll} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                {allCurrentSelected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}
                选择本页
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500">
                  <tr>
                    <th className="px-4 py-3 w-10" />
                    <th className="px-4 py-3 text-left">姓名</th>
                    <th className="px-4 py-3 text-left">地区</th>
                    <th className="px-4 py-3 text-left">学校</th>
                    <th className="px-4 py-3 text-left">电话尾号</th>
                    <th className="px-4 py-3 text-left">原话务员</th>
                    <th className="px-4 py-3 text-left">无效原因</th>
                    <th className="px-4 py-3 text-left">更新时间</th>
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
                      <td colSpan={8} className="py-12 text-center text-gray-400">暂无无效线索</td>
                    </tr>
                  ) : (
                    students.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/20">
                        <td className="px-4 py-3">
                          <button onClick={() => toggleSel(s.id)}>
                            {selected.has(s.id) ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-gray-400" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{s.name}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{s.region || '-'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{s.school_name || '-'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{s.guardian_phone ? `****${s.guardian_phone}` : '-'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{s.agent_name || '-'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          <span className={s.invalid_reason ? '' : 'text-gray-400 dark:text-gray-600'}>
                            {s.invalid_reason || '未填写'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatDateTime(s.updated_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {total > PAGE_SIZE && (
              <div className="px-4 py-3 border-t dark:border-gray-700 flex items-center justify-between">
                <div className="text-sm text-gray-500 dark:text-gray-400">第 {page} / {totalPages} 页</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchInvalid(page - 1)}
                    disabled={loading || page <= 1}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" /> 上一页
                  </button>
                  <button
                    onClick={() => fetchInvalid(page + 1)}
                    disabled={loading || page >= totalPages}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-40"
                  >
                    下一页 <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
