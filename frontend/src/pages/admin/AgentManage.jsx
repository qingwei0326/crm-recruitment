import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import {
  ArrowLeft,
  Users,
  UserPlus,
  Eye,
  Trash2,
  Edit3,
  LogOut,
  Menu,
  Phone,
  Target,
  CheckCircle2,
  Clock,
  X,
  Loader2,
  Sun,
  Moon,
  BarChart3,
  TrendingUp,
} from 'lucide-react';

const inputCls =
  'w-full px-3 py-2 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400';

export default function AgentManage() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();

  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentTasks, setAgentTasks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [taskLoading, setTaskLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    role: 'agent',
    service_regions: '',
  });
  const [formError, setFormError] = useState('');

  const fetchAgents = () => {
    setLoading(true);
    api
      .get('/admin/agents')
      .then((res) => setAgents(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    fetchAgents();
  }, []);

  const viewAgentTasks = async (agent) => {
    setSelectedAgent(agent);
    setTaskLoading(true);
    setAgentTasks(null);
    try {
      const res = await api.get(`/admin/agents/${agent.id}/tasks`);
      setAgentTasks(res.data.data);
    } catch {
      setAgentTasks(null);
    } finally {
      setTaskLoading(false);
    }
    if (isMobile) setSidebarOpen(false); // auto-close list on mobile
  };

  const openCreateModal = () => {
    setEditingUser(null);
    setForm({ username: '', password: '', name: '', role: 'agent', service_regions: '' });
    setFormError('');
    setShowModal(true);
  };
  const openEditModal = (agent) => {
    setEditingUser(agent);
    setForm({
      username: agent.username,
      password: '',
      name: agent.name,
      role: 'agent',
      service_regions: agent.service_regions || '',
    });
    setFormError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name) return setFormError('请输入姓名');
    if (!editingUser && !form.username) return setFormError('请输入用户名');
    if (!editingUser && !form.password) return setFormError('请输入密码');
    try {
      if (editingUser) {
        const body = { name: form.name, service_regions: form.service_regions };
        if (form.password) body.password = form.password;
        await api.put(`/admin/users/${editingUser.id}`, body);
      } else {
        await api.post('/admin/users', form);
      }
      setShowModal(false);
      fetchAgents();
    } catch (err) {
      setFormError(err.response?.data?.msg || '操作失败');
    }
  };

  const handleToggleActive = async (agent) => {
    await api.put(`/admin/users/${agent.id}`, { is_active: !agent.is_active });
    fetchAgents();
  };
  const handleDelete = async (agent) => {
    if (!confirm(`确定删除话务员「${agent.name}」吗？其线索将回收至线索池。`)) return;
    await api.delete(`/admin/users/${agent.id}`);
    fetchAgents();
    if (selectedAgent?.id === agent.id) setSelectedAgent(null);
  };
  const handleResetPassword = async (agent) => {
    if (!confirm(`确定重置「${agent.name}」的密码吗？系统将生成一个随机临时密码。`)) return;
    try {
      const res = await api.post(`/admin/users/${agent.id}/reset-password`);
      alert(res.data.msg || '密码已重置');
    } catch (err) {
      alert(err.response?.data?.msg || '操作失败');
    }
  };

  const closeSidebar = () => setSidebarOpen(false);

  const SidebarNav = () => (
    <>
      <div className="flex items-center justify-between px-4 h-14 border-b dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Users className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">CRM 管理后台</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{user?.name}</div>
          </div>
        </div>
        {isMobile && (
          <button
            onClick={closeSidebar}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        )}
      </div>
      <nav className="p-3 space-y-1">
        <Link
          to="/admin"
          onClick={closeSidebar}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> 返回仪表盘
        </Link>
        <Link
          to="/admin/report"
          onClick={closeSidebar}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
        >
          <BarChart3 className="w-4 h-4" /> 汇总报表
        </Link>
        <Link
          to="/admin/trend"
          onClick={closeSidebar}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
        >
          <TrendingUp className="w-4 h-4" /> 趋势报表
        </Link>
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
          <Users className="w-4 h-4" /> 话务员管理
        </div>
      </nav>
      <div className="mt-auto p-3 border-t dark:border-gray-700 space-y-1">
        <button
          onClick={toggle}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
        >
          {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}{' '}
          {dark ? '亮色模式' : '暗色模式'}
        </button>
        <button
          onClick={logout}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <LogOut className="w-4 h-4" /> 退出登录
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-900">
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-20" onClick={closeSidebar} />
      )}
      <aside
        className={`${isMobile ? 'fixed inset-y-0 left-0 z-30 shadow-2xl transform transition-transform ' + (sidebarOpen ? 'translate-x-0' : '-translate-x-full') : ''} w-60 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col`}
      >
        <SidebarNav />
      </aside>

      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">话务员管理</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openCreateModal}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              <UserPlus className="w-4 h-4" />
              {!isMobile && '添加话务员'}
            </button>
            {isMobile && (
              <button
                onClick={toggle}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {dark ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4 text-gray-500" />
                )}
              </button>
            )}
          </div>
        </header>

        <div className="p-4 lg:p-6 max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
            {/* Agent list — on mobile, show as full-width when no agent selected, hidden when viewing tasks */}
            <div className={`lg:w-80 shrink-0 ${isMobile && selectedAgent ? 'hidden' : ''}`}>
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                    <Users className="w-4 h-4" /> 话务员列表 ({agents.length})
                  </h3>
                </div>
                <div className="divide-y dark:divide-gray-700 max-h-[calc(100vh-14rem)] overflow-y-auto">
                  {loading ? (
                    <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                      加载中...
                    </div>
                  ) : agents.length === 0 ? (
                    <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                      暂无话务员
                    </div>
                  ) : (
                    agents.map((a) => (
                      <div
                        key={a.id}
                        onClick={() => viewAgentTasks(a)}
                        className={`px-4 py-3 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${selectedAgent?.id === a.id ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                              {a.name}
                              {!a.is_active && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
                                  已禁用
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              @{a.username}
                              {a.service_regions ? ` · ${a.service_regions}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditModal(a);
                              }}
                              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(a);
                              }}
                              className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            <Target className="w-3 h-3" />
                            {a.total_tasks}
                          </span>
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            {a.done_tasks}
                          </span>
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {a.today_calls}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Task detail — on mobile, full screen when viewing */}
            <div className={`flex-1 ${isMobile && !selectedAgent ? 'hidden' : ''}`}>
              {/* Mobile back button */}
              {isMobile && selectedAgent && (
                <button
                  onClick={() => setSelectedAgent(null)}
                  className="mb-3 flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400"
                >
                  <ArrowLeft className="w-4 h-4" /> 返回列表
                </button>
              )}

              {!selectedAgent ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm flex flex-col items-center justify-center py-20 text-gray-300 dark:text-gray-600">
                  <Eye className="w-12 h-12 mb-3" />
                  <p className="text-sm">点击左侧话务员查看其任务详情</p>
                </div>
              ) : taskLoading ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                </div>
              ) : agentTasks ? (
                <div className="space-y-4">
                  <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-4 lg:p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                          {agentTasks.agent.name}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          @{agentTasks.agent.username}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggleActive(selectedAgent)}
                          className={`text-xs px-3 py-1.5 rounded-lg ${selectedAgent.is_active ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50' : 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50'}`}
                        >
                          {selectedAgent.is_active ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={() => openEditModal(selectedAgent)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleResetPassword(selectedAgent)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                        >
                          重置密码
                        </button>
                      </div>
                    </div>
                    <div
                      className={`grid ${isMobile ? 'grid-cols-3' : 'grid-cols-4 lg:grid-cols-7'} gap-2`}
                    >
                      {[
                        {
                          label: '总任务',
                          value: agentTasks.stats.total,
                          color: 'text-blue-600 dark:text-blue-400',
                        },
                        {
                          label: '已完成',
                          value: agentTasks.stats.done,
                          color: 'text-green-600 dark:text-green-400',
                        },
                        {
                          label: '待联系',
                          value: agentTasks.stats.pending,
                          color: 'text-gray-600 dark:text-gray-300',
                        },
                        {
                          label: '待回访',
                          value: agentTasks.stats.follow_up,
                          color: 'text-amber-600 dark:text-amber-400',
                        },
                        {
                          label: 'A级意向',
                          value: agentTasks.stats.a_level,
                          color: 'text-red-600 dark:text-red-400',
                        },
                        {
                          label: '查看次数',
                          value: agentTasks.stats.view_count,
                          color: 'text-purple-600 dark:text-purple-400',
                        },
                        {
                          label: '进度',
                          value: agentTasks.stats.progress_pct + '%',
                          color: 'text-teal-600 dark:text-teal-400',
                        },
                      ].map((s, i) => (
                        <div
                          key={i}
                          className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800"
                        >
                          <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                        任务列表 ({agentTasks.list.length})
                      </h4>
                    </div>
                    <div className="divide-y dark:divide-gray-700 max-h-[calc(100vh-28rem)] overflow-y-auto">
                      {agentTasks.list.length === 0 ? (
                        <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                          暂无任务
                        </div>
                      ) : (
                        agentTasks.list.map((l) => (
                          <div
                            key={l.id}
                            className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {l.name}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {l.phone} · {l.source || '-'}
                              </div>
                            </div>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                l.status === '已报名'
                                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                                  : l.status === '未联系'
                                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                                    : l.status === '待回访'
                                      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                                      : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                              }`}
                            >
                              {l.status}
                            </span>
                            {l.intent_level !== '无' && (
                              <span
                                className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${l.intent_level === 'A' ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : l.intent_level === 'B' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                              >
                                {l.intent_level}
                              </span>
                            )}
                            {!isMobile && (
                              <span className="text-xs text-gray-400 dark:text-gray-500 w-24 text-right">
                                {l.updated_at?.split(' ')[0]}
                              </span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </main>

      {/* Add/Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                {editingUser ? '编辑话务员' : '添加话务员'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="space-y-3">
              {!editingUser && (
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    用户名
                  </label>
                  <input
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className={inputCls}
                    placeholder="登录账号"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">姓名</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls}
                  placeholder="显示名称"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                  密码{editingUser ? '（留空不修改）' : ''}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={inputCls}
                  placeholder={editingUser ? '留空则不修改密码' : '设置密码'}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                  负责地域{' '}
                  <span className="text-xs text-gray-400">（逗号分隔，如"龙海,芗城"）</span>
                </label>
                <input
                  value={form.service_regions}
                  onChange={(e) => setForm({ ...form, service_regions: e.target.value })}
                  className={inputCls}
                  placeholder="龙海,芗城"
                />
              </div>
              {formError && (
                <div className="text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">
                  {formError}
                </div>
              )}
              <button
                onClick={handleSave}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700"
              >
                {editingUser ? '保存修改' : '创建账号'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
