/**
 * 多学校分发页面
 *
 * 按学校展示未分配学员，勾选学校后一键分发给话务员。
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { getApiErrorMessage } from '../../utils';
import {
  Loader2, LogOut, Menu, X, Sun, Moon, RefreshCcw,
  ChevronDown, ChevronUp, Users, LayoutDashboard, ListFilter,
  ArrowRightLeft, BarChart3, TrendingUp, Search, Settings,
  Send, School, CheckSquare, Square,
} from 'lucide-react';

export default function DistributeBySchools() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [schoolGroups, setSchoolGroups] = useState([]);
  const [selectedSchools, setSelectedSchools] = useState(new Set());
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [expandedStudents, setExpandedStudents] = useState([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [agents, setAgents] = useState([]);
  const [mode, setMode] = useState('auto'); // auto | manual
  const [targetAgentId, setTargetAgentId] = useState('');

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/unassigned-school-groups');
      if (res.data.code === 0) {
        setSchoolGroups(res.data.data?.groups || []);
      } else {
        toast?.error(res.data.msg || '加载失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await api.get('/admin/agents');
      if (res.data.code === 0) setAgents(res.data.data || []);
    } catch {}
  };

  const fetchSchoolStudents = async (schoolName) => {
    setExpandedLoading(true);
    try {
      const res = await api.get('/admin/leads', {
        params: { page: 1, page_size: 200, school_name: schoolName, assignment: 'unassigned' },
      });
      if (res.data.code === 0) {
        setExpandedStudents(res.data.data?.list || []);
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setExpandedLoading(false);
    }
  };

  useEffect(() => { fetchGroups(); fetchAgents(); }, []);

  const toggleSchool = (name) => {
    const next = new Set(selectedSchools);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedSchools(next);
  };

  const toggleAll = () => {
    if (selectedSchools.size === schoolGroups.length) {
      setSelectedSchools(new Set());
    } else {
      setSelectedSchools(new Set(schoolGroups.map((g) => g.name)));
    }
  };

  const toggleExpand = async (schoolName) => {
    if (expandedSchool === schoolName) {
      setExpandedSchool(null);
      setExpandedStudents([]);
    } else {
      setExpandedSchool(schoolName);
      await fetchSchoolStudents(schoolName);
    }
  };

  const handleDistribute = async () => {
    if (selectedSchools.size === 0) {
      toast?.warning('请先选择学校');
      return;
    }
    if (mode === 'manual' && !targetAgentId) {
      toast?.warning('请选择目标话务员');
      return;
    }
    const totalStudents = schoolGroups
      .filter((g) => selectedSchools.has(g.name))
      .reduce((sum, g) => sum + g.count, 0);
    const agentName = mode === 'manual'
      ? agents.find((a) => String(a.id) === String(targetAgentId))?.name || '该话务员'
      : '所有话务员（按负载均衡）';

    const ok = await confirm({
      title: '多学校分发',
      message: `确定将 ${selectedSchools.size} 所学校的 ${totalStudents} 名未分配学员分发给「${agentName}」吗？`,
      confirmText: '确认分发',
    });
    if (!ok) return;

    setDistributing(true);
    try {
      const payload = {
        school_names: [...selectedSchools],
        mode,
      };
      if (mode === 'manual') payload.agent_id = Number(targetAgentId);
      const res = await api.post('/admin/distribute-by-schools', payload);
      if (res.data.code === 0) {
        const d = res.data.data || {};
        const distStr = Object.entries(d.distribution || {}).map(([k, v]) => `${k}:${v}`).join('、');
        toast?.success(`成功分发 ${d.distributed_count} 名学员：${distStr}`);
        setSelectedSchools(new Set());
        fetchGroups();
      } else {
        toast?.error(res.data.msg || '分发失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setDistributing(false);
    }
  };

  const totalUnassigned = schoolGroups.reduce((sum, g) => sum + g.count, 0);
  const selectedCount = schoolGroups
    .filter((g) => selectedSchools.has(g.name))
    .reduce((sum, g) => sum + g.count, 0);

  const closeSidebar = () => setSidebarOpen(false);

  const SidebarNav = () => (
    <>
      <div className="flex items-center justify-between px-4 h-14 border-b dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center">
            <Send className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">多学校分发</div>
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
        <Link to="/admin/invalid-reclaim" onClick={closeSidebar} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium">
          <RefreshCcw className="w-4 h-4" /> 无效线索回收
        </Link>
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm font-medium">
          <Send className="w-4 h-4" /> 多学校分发
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
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">多学校分发</h2>
          </div>
          <button onClick={toggle} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
        </header>

        <div className="p-4 lg:p-6 space-y-4">
          {/* 工具栏 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <button onClick={fetchGroups} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                <RefreshCcw className="w-4 h-4" /> 刷新
              </button>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                共 <span className="font-bold text-blue-600">{totalUnassigned}</span> 名未分配学员，
                已选 <span className="font-bold text-green-600">{selectedCount}</span> 名
              </div>
              <div className="flex-1" />
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                {/* 分发模式 */}
                <div className="flex items-center gap-2">
                  <select value={mode} onChange={(e) => setMode(e.target.value)}
                    className="px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                    <option value="auto">自动均衡分发</option>
                    <option value="manual">指定话务员</option>
                  </select>
                  {mode === 'manual' && (
                    <select value={targetAgentId} onChange={(e) => setTargetAgentId(e.target.value)}
                      className="px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 min-w-[120px]">
                      <option value="">选择话务员</option>
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}
                </div>
                <button
                  onClick={handleDistribute}
                  disabled={distributing || selectedSchools.size === 0}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-green-700"
                >
                  {distributing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  分发所选学校
                </button>
              </div>
            </div>
          </div>

          {/* 学校列表 */}
          <div className="space-y-2">
            {loading ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-12 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
              </div>
            ) : schoolGroups.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-12 text-center text-gray-400">
                暂无未分配学员
              </div>
            ) : (
              <>
                {/* 全选 */}
                <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  onClick={toggleAll}>
                  {selectedSchools.size === schoolGroups.length
                    ? <CheckSquare className="w-4 h-4 text-green-600" />
                    : <Square className="w-4 h-4 text-gray-400" />
                  }
                  <span className="text-sm text-gray-600 dark:text-gray-400">全选所有学校</span>
                </div>

                {schoolGroups.map((g) => (
                  <div key={g.name} className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => toggleExpand(g.name)}>
                        <button onClick={(e) => { e.stopPropagation(); toggleSchool(g.name); }}>
                          {selectedSchools.has(g.name)
                            ? <CheckSquare className="w-4 h-4 text-green-600" />
                            : <Square className="w-4 h-4 text-gray-400" />
                          }
                        </button>
                        {expandedSchool === g.name
                          ? <ChevronUp className="w-4 h-4 text-gray-400" />
                          : <ChevronDown className="w-4 h-4 text-gray-400" />
                        }
                        <School className="w-4 h-4 text-blue-500" />
                        <span className="font-medium text-gray-800 dark:text-gray-100">{g.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium">
                          {g.count} 人
                        </span>
                      </div>
                    </div>

                    {expandedSchool === g.name && (
                      <div className="border-t dark:border-gray-700">
                        {expandedLoading ? (
                          <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
                        ) : expandedStudents.length === 0 ? (
                          <div className="p-6 text-center text-gray-400 text-sm">暂无数据</div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 text-xs">
                                <tr>
                                  <th className="px-4 py-2 text-left">姓名</th>
                                  <th className="px-4 py-2 text-left">地区</th>
                                  <th className="px-4 py-2 text-left">成绩</th>
                                  <th className="px-4 py-2 text-left">监护人</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y dark:divide-gray-700/50">
                                {expandedStudents.map((s) => (
                                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/20">
                                    <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-100">{s.name}</td>
                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.region || '-'}</td>
                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.score ?? '-'}</td>
                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{s.guardian_name || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
