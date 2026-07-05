import { useState, useEffect, useMemo, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { formatDateTime, getApiErrorMessage } from '../../utils';
import { adminRecycleStatusBadgeClass, statusLabel } from '../../labels';
import {
  ADMIN_OPERATION_PERMISSION_OPTIONS,
  ADMIN_OPERATION_PERMISSIONS,
  ADMIN_PAGE_PERMISSION_OPTIONS,
  canPerformAdminOperation,
  normalizeAdminOperationPermissions,
  normalizeAdminPagePermissions,
} from '../../adminPermissions';
import {
  getAgentListGroup,
  inputCls,
  isAdminAccount,
  isAgentAccount,
  isLocked,
  permissionSummary,
  roleLabel,
  validateDisplayName,
} from './agentManageUtils';
import {
  ArrowLeft,
  Users,
  UserPlus,
  Eye,
  UserX,
  Edit3,
  Phone,
  Target,
  CheckCircle2,
  ArrowRightLeft,
  X,
  Loader2,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Lock,
  Unlock,
} from 'lucide-react';

export default function AgentManage() {
  const { dark, toggle } = useTheme();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const toast = useToast();

  const [agents, setAgents] = useState([]);
  const [agentStatusFilter, setAgentStatusFilter] = useState('active');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentTasks, setAgentTasks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [taskLoading, setTaskLoading] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [taskDetailCache, setTaskDetailCache] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recycleAgent, setRecycleAgent] = useState(null);
  const [recycleStudents, setRecycleStudents] = useState([]);
  const [recycleSelected, setRecycleSelected] = useState(new Set());
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [recycleActionLoading, setRecycleActionLoading] = useState(false);
  const [recycleAgentId, setRecycleAgentId] = useState('');
  const recycleAllCheckboxRef = useRef(null);

  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    role: 'agent',
    is_super_admin: false,
    page_permissions: [],
    operation_permissions: [],
  });
  const [formError, setFormError] = useState('');
  const canGrantAdminPermissions = Boolean(user?.is_super_admin);
  const canCreateUsers = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.userCreate);
  const canEditUsers = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.userEdit);
  const canOffboardUsers = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.userOffboard);
  const canUnlockUsers = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.userUnlock);
  const canResetPasswords = canPerformAdminOperation(
    user,
    ADMIN_OPERATION_PERMISSIONS.userResetPassword,
  );
  const canAssignStudents = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentAssign);
  const canEditAccount = (account) =>
    canEditUsers && (!isAdminAccount(account) || canGrantAdminPermissions);
  const canOperateAdminAccount = (account) => !isAdminAccount(account) || canGrantAdminPermissions;
  const activeAgents = useMemo(
    () => agents.filter((agent) => isAgentAccount(agent) && agent.is_active),
    [agents],
  );
  const agentFilterOptions = useMemo(
    () => [
      { key: 'active', label: '在职', count: agents.filter((agent) => agent.is_active).length },
      { key: 'inactive', label: '离职', count: agents.filter((agent) => !agent.is_active).length },
      { key: 'all', label: '全部', count: agents.length },
    ],
    [agents],
  );

  const visibleAgents = useMemo(() => {
    if (agentStatusFilter === 'inactive') {
      return agents.filter((agent) => !agent.is_active);
    }
    if (agentStatusFilter === 'all') {
      return agents;
    }
    return agents.filter((agent) => agent.is_active);
  }, [agents, agentStatusFilter]);

  const sortedAgents = useMemo(
    () =>
      visibleAgents
        .map((agent, index) => ({ agent, index }))
        .sort((left, right) => {
          const groupDiff = getAgentListGroup(left.agent) - getAgentListGroup(right.agent);
          return groupDiff || left.index - right.index;
        })
        .map(({ agent }) => agent),
    [visibleAgents],
  );

  const fetchAgents = () => {
    setLoading(true);
    api
      .get('/admin/users')
      .then((res) => setAgents(res.data.data || []))
      .catch(() => { toast?.error('数据加载失败'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    fetchAgents();
  }, []);

  useEffect(() => {
    if (!recycleAllCheckboxRef.current) return;
    recycleAllCheckboxRef.current.indeterminate =
      recycleSelected.size > 0 && recycleSelected.size < recycleStudents.length;
  }, [recycleSelected, recycleStudents]);

  const viewAgentTasks = async (agent) => {
    setSelectedAgent(agent);
    if (!isAgentAccount(agent)) {
      setTaskLoading(false);
      setAgentTasks(null);
      setExpandedTaskId(null);
      setTaskDetailCache({});
      if (isMobile) setSidebarOpen(false);
      return;
    }
    setTaskLoading(true);
    setAgentTasks(null);
    setExpandedTaskId(null);
    setTaskDetailCache({});
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

  const loadTaskDetail = async (task) => {
    setTaskDetailCache((prev) => ({
      ...prev,
      [task.id]: {
        loading: true,
        student: task,
        notes: [],
      },
    }));
    try {
      const [studentResult, notesResult] = await Promise.allSettled([
        api.get(`/students/${task.id}`),
        api.get(`/notes?student_id=${task.id}`),
      ]);

      if (studentResult.status === 'rejected') {
        setTaskDetailCache((prev) => ({
          ...prev,
          [task.id]: {
            loading: false,
            student: task,
            notes: [],
            error: getApiErrorMessage(studentResult.reason),
          },
        }));
        return;
      }

      setTaskDetailCache((prev) => ({
        ...prev,
        [task.id]: {
          loading: false,
          student: studentResult.value.data.data,
          notes:
            notesResult.status === 'fulfilled'
              ? (notesResult.value.data.data || []).slice(0, 3)
              : [],
          notesError:
            notesResult.status === 'rejected' ? getApiErrorMessage(notesResult.reason) : '',
        },
      }));
    } catch (error) {
      setTaskDetailCache((prev) => ({
        ...prev,
        [task.id]: {
          loading: false,
          student: task,
          notes: [],
          error: getApiErrorMessage(error),
        },
      }));
    }
  };

  const toggleTaskDetail = (task) => {
    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
      return;
    }
    setExpandedTaskId(task.id);
    if (!taskDetailCache[task.id] || taskDetailCache[task.id].error) {
      loadTaskDetail(task);
    }
  };

  const openCreateModal = () => {
    setEditingUser(null);
    setForm({
      username: '',
      password: '',
      name: '',
      role: 'agent',
      is_super_admin: false,
      page_permissions: [],
      operation_permissions: [],
    });
    setFormError('');
    setShowModal(true);
  };
  const openEditModal = (agent) => {
    setEditingUser(agent);
    setForm({
      username: agent.username,
      password: '',
      name: agent.name,
      role: agent.role || 'agent',
      is_super_admin: Boolean(agent.is_super_admin),
      page_permissions: normalizeAdminPagePermissions(agent.page_permissions),
      operation_permissions: normalizeAdminOperationPermissions(agent.operation_permissions),
    });
    setFormError('');
    setShowModal(true);
  };

  const togglePagePermission = (permissionKey) => {
    setForm((prev) => {
      const permissions = new Set(normalizeAdminPagePermissions(prev.page_permissions));
      if (permissions.has(permissionKey)) {
        permissions.delete(permissionKey);
      } else {
        permissions.add(permissionKey);
      }
      return { ...prev, page_permissions: [...permissions] };
    });
  };

  const toggleOperationPermission = (permissionKey) => {
    setForm((prev) => {
      const permissions = new Set(
        normalizeAdminOperationPermissions(prev.operation_permissions),
      );
      if (permissions.has(permissionKey)) {
        permissions.delete(permissionKey);
      } else {
        permissions.add(permissionKey);
      }
      return { ...prev, operation_permissions: [...permissions] };
    });
  };

  const handleSave = async () => {
    const nameError = validateDisplayName(form.name);
    if (nameError) return setFormError(nameError);
    if (!editingUser && !form.username) return setFormError('请输入用户名');
    if (!editingUser && !form.password) return setFormError('请输入密码');
    if (editingUser && form.password && !canResetPasswords) {
      return setFormError('无权重置账号密码');
    }
    try {
      if (editingUser) {
        const body = {
          name: form.name.trim(),
        };
        if (canGrantAdminPermissions) {
          body.role = form.role;
          body.is_super_admin = Boolean(form.is_super_admin);
          body.page_permissions =
            form.role === 'admin' && !form.is_super_admin
              ? normalizeAdminPagePermissions(form.page_permissions)
              : [];
          body.operation_permissions =
            form.role === 'admin' && !form.is_super_admin
              ? normalizeAdminOperationPermissions(form.operation_permissions)
              : [];
        }
        if (form.password) body.password = form.password;
        await api.put(`/admin/users/${editingUser.id}`, body);
      } else {
        const body = {
          username: form.username,
          password: form.password,
          name: form.name.trim(),
          role: canGrantAdminPermissions ? form.role : 'agent',
        };
        if (canGrantAdminPermissions && form.role === 'admin') {
          body.is_super_admin = Boolean(form.is_super_admin);
          body.page_permissions = form.is_super_admin
            ? []
            : normalizeAdminPagePermissions(form.page_permissions);
          body.operation_permissions = form.is_super_admin
            ? []
            : normalizeAdminOperationPermissions(form.operation_permissions);
        }
        await api.post('/admin/users', body);
      }
      setShowModal(false);
      fetchAgents();
    } catch (err) {
      setFormError(err.response?.data?.msg || '操作失败');
    }
  };

  const handleToggleActive = async (agent) => {
    if (agent.is_active) {
      const ok = await confirm({
        title: `禁用「${agent.name}」`,
        message:
          '禁用后该话务员将无法登录系统，旧登录会立即失效。\n' +
          '不会回收线索，已分配学生仍保留在该账号名下。',
        confirmText: '禁用',
        tone: 'danger',
      });
      if (!ok) return;
    }
    await api.put(`/admin/users/${agent.id}`, { is_active: !agent.is_active });
    fetchAgents();
  };
  const handleOffboard = async (agent) => {
    const ok = await confirm({
      title: `为「${agent.name}」办理离职`,
      message:
        `· 回收非终态线索，状态/意向/阶段会重置\n` +
        `· 保留已报名/无效历史记录，只解绑归属\n` +
        `· 账号会被禁用、已登录的会话立即失效\n\n` +
        `账号会保留以便保留历史，如需彻底删除请联系开发者。`,
      confirmText: '办理离职',
      tone: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      const res = await api.post(`/admin/users/${agent.id}/offboard`);
      const d = res.data?.data;
      if (d) {
        toast?.success(
          `${agent.name} 已办理离职：回收线索 ${d.recycled_count} 条，保留历史 ${d.preserved_count} 条`,
        );
      }
      fetchAgents();
      if (selectedAgent?.id === agent.id) setSelectedAgent(null);
    } catch (err) {
      toast?.error(getApiErrorMessage(err));
    }
  };
  const handleResetPassword = async (agent) => {
    const ok = await confirm({
      title: '重置密码',
      message:
        `确定重置「${agent.name}」的密码吗？系统将生成一个随机临时密码。\n` +
        '旧登录会立即失效，对方需要用临时密码重新登录并改密。',
      confirmText: '重置密码',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api.post(`/admin/users/${agent.id}/reset-password`);
      toast?.success(res.data.msg || '密码已重置');
    } catch (err) {
      toast?.error(err.response?.data?.msg || '操作失败');
    }
  };
  const handleUnlock = async (agent) => {
    try {
      const res = await api.post(`/admin/users/${agent.id}/unlock`);
      toast?.success(res.data.msg || '已解锁');
      fetchAgents();
      if (selectedAgent?.id === agent.id) {
        setSelectedAgent((prev) =>
          prev ? { ...prev, locked_until: null, failed_login_attempts: 0 } : prev,
        );
      }
    } catch (err) {
      toast?.error(getApiErrorMessage(err));
    }
  };

  const fetchRecycleStudents = async (agentId) => {
    setRecycleLoading(true);
    try {
      const res = await api.get('/admin/stale-students', { params: { agent_id: agentId } });
      setRecycleStudents(res.data.data || []);
      setRecycleSelected(new Set());
    } catch (error) {
      setRecycleStudents([]);
      toast?.error(getApiErrorMessage(error));
    } finally {
      setRecycleLoading(false);
    }
  };

  const openRecycleModal = (agent) => {
    setRecycleAgent(agent);
    setRecycleAgentId('');
    setRecycleStudents([]);
    setRecycleSelected(new Set());
    fetchRecycleStudents(agent.id);
  };

  const closeRecycleModal = () => {
    if (recycleActionLoading) return;
    setRecycleAgent(null);
    setRecycleStudents([]);
    setRecycleSelected(new Set());
    setRecycleAgentId('');
  };

  const toggleRecycleSelection = (studentId) => {
    setRecycleSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const toggleRecycleAll = () => {
    if (recycleSelected.size === recycleStudents.length) {
      setRecycleSelected(new Set());
      return;
    }
    setRecycleSelected(new Set(recycleStudents.map((item) => item.student_id)));
  };

  const handleRecycleReassign = async (mode) => {
    if (recycleSelected.size === 0 || !recycleAgent) return;
    if (mode === 'manual' && !recycleAgentId) return;

    setRecycleActionLoading(true);
    try {
      const res = await api.post('/admin/stale-reassign', {
        student_ids: [...recycleSelected],
        mode,
        agent_id: mode === 'manual' ? Number(recycleAgentId) : undefined,
      });
      if (res.data.code === 0) {
        await fetchRecycleStudents(recycleAgent.id);
        fetchAgents();
        if (selectedAgent?.id === recycleAgent.id) {
          viewAgentTasks(recycleAgent);
        }
      } else {
        toast?.error(res.data.msg || '操作失败');
      }
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setRecycleActionLoading(false);
    }
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="账号管理"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          actionsClassName="flex items-center gap-2"
        >
          {canCreateUsers && (
            <button
              onClick={openCreateModal}
              aria-label="添加账号"
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              <UserPlus className="w-4 h-4" />
              {!isMobile && '添加账号'}
            </button>
          )}
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
        </PageHeader>

        <div className="p-4 lg:p-6 max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
            {/* Agent list — on mobile, show as full-width when no agent selected, hidden when viewing tasks */}
            <div className={`lg:w-80 shrink-0 ${isMobile && selectedAgent ? 'hidden' : ''}`}>
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                      <Users className="w-4 h-4" /> 账号列表 ({visibleAgents.length})
                    </h3>
                    <div className="inline-flex rounded-lg border dark:border-gray-700 overflow-hidden text-xs">
                      {agentFilterOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => {
                            setAgentStatusFilter(option.key);
                            setSelectedAgent(null);
                          }}
                          className={`px-2.5 py-1 transition-colors ${
                            agentStatusFilter === option.key
                              ? 'bg-blue-600 text-white'
                              : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          {option.label} {option.count}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="divide-y dark:divide-gray-700 max-h-[calc(100vh-14rem)] overflow-y-auto">
                  {loading ? (
                    <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                      加载中...
                    </div>
                  ) : sortedAgents.length === 0 ? (
                    <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                      {agentStatusFilter === 'inactive' ? '暂无离职账号' : '暂无账号'}
                    </div>
                  ) : (
                    sortedAgents.map((a) => (
                      <div
                        key={a.id}
                        onClick={() => viewAgentTasks(a)}
                        className={`px-4 py-3 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${selectedAgent?.id === a.id ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 flex flex-wrap items-center gap-1.5">
                              <span className="truncate max-w-[7.5rem] break-normal whitespace-nowrap">
                                {a.name}
                              </span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
                                {roleLabel(a)}
                              </span>
                              {!a.is_active && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 whitespace-nowrap">
                                  已离职
                                </span>
                              )}
                              {isLocked(a) && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 inline-flex items-center gap-0.5">
                                  <Lock className="w-3 h-3" />
                                  已锁定
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                              @{a.username}
                            </div>
                            {permissionSummary(a) && (
                              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                                {permissionSummary(a)}
                              </div>
                            )}
                          </div>
                          <div className="shrink-0 flex flex-wrap justify-end gap-1 max-w-[10rem]">
                            {canUnlockUsers && canOperateAdminAccount(a) && isLocked(a) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUnlock(a);
                                }}
                                title="解锁账号（清除登录失败锁定）"
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20 text-xs whitespace-nowrap"
                              >
                                <Unlock className="w-3.5 h-3.5" />
                                解锁
                              </button>
                            )}
                            {canEditAccount(a) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditModal(a);
                                }}
                                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                              </button>
                            )}
                            {canAssignStudents && a.is_active && isAgentAccount(a) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openRecycleModal(a);
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-xs whitespace-nowrap"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                                回收
                              </button>
                            )}
                            {canOffboardUsers && a.is_active && isAgentAccount(a) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOffboard(a);
                                }}
                                title="办理离职：回收线索、禁用账号、保留历史"
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs whitespace-nowrap"
                              >
                                <UserX className="w-3.5 h-3.5" />
                                离职
                              </button>
                            )}
                          </div>
                        </div>
                        {isAgentAccount(a) && (
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
                        )}
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
                  <p className="text-sm">点击左侧账号查看详情</p>
                </div>
              ) : taskLoading ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                </div>
              ) : !isAgentAccount(selectedAgent) ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-4 lg:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                        {selectedAgent.name}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        @{selectedAgent.username} · {roleLabel(selectedAgent)}
                      </p>
                      {permissionSummary(selectedAgent) && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {permissionSummary(selectedAgent)}
                        </p>
                      )}
                    </div>
                    {(canEditAccount(selectedAgent)
                      || (canResetPasswords && canOperateAdminAccount(selectedAgent))) && (
                      <div className="flex flex-wrap justify-end gap-2">
                        {canEditAccount(selectedAgent) && (
                          <button
                            onClick={() => openEditModal(selectedAgent)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                          >
                            编辑
                          </button>
                        )}
                        {canResetPasswords && canOperateAdminAccount(selectedAgent) && (
                          <button
                            onClick={() => handleResetPassword(selectedAgent)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                          >
                            重置密码
                          </button>
                        )}
                        {canEditAccount(selectedAgent) && (
                          <button
                            onClick={() => handleToggleActive(selectedAgent)}
                            className={`text-xs px-3 py-1.5 rounded-lg ${selectedAgent.is_active ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50' : 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50'}`}
                          >
                            {selectedAgent.is_active ? '禁用' : '启用'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                      <div className="text-xs text-gray-500 dark:text-gray-400">状态</div>
                      <div className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-100">
                        {selectedAgent.is_active ? '启用' : '禁用'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                      <div className="text-xs text-gray-500 dark:text-gray-400">权限</div>
                      <div className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-100">
                        {roleLabel(selectedAgent)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                      <div className="text-xs text-gray-500 dark:text-gray-400">创建时间</div>
                      <div className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-100">
                        {formatDateTime(selectedAgent.created_at) || '-'}
                      </div>
                    </div>
                  </div>
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
                      {(canEditAccount(selectedAgent)
                        || (canResetPasswords && canOperateAdminAccount(selectedAgent))
                        || (canUnlockUsers && canOperateAdminAccount(selectedAgent))
                        || canAssignStudents) && (
                        <div className="flex flex-wrap justify-end gap-2">
                          {canEditAccount(selectedAgent) && (
                            <button
                              onClick={() => openEditModal(selectedAgent)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                              编辑
                            </button>
                          )}
                          {canResetPasswords && canOperateAdminAccount(selectedAgent) && (
                            <button
                              onClick={() => handleResetPassword(selectedAgent)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                            >
                              重置密码
                            </button>
                          )}
                          {canUnlockUsers && canOperateAdminAccount(selectedAgent) && isLocked(selectedAgent) && (
                            <button
                              onClick={() => handleUnlock(selectedAgent)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/50 inline-flex items-center gap-1"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              解锁
                            </button>
                          )}
                          {canAssignStudents && (
                            <button
                              onClick={() => openRecycleModal(selectedAgent)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 inline-flex items-center gap-1"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              回收
                            </button>
                          )}
                          {canEditAccount(selectedAgent) && (
                            <button
                              onClick={() => handleToggleActive(selectedAgent)}
                              className={`text-xs px-3 py-1.5 rounded-lg ${selectedAgent.is_active ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50' : 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50'}`}
                            >
                              {selectedAgent.is_active ? '禁用' : '启用'}
                            </button>
                          )}
                        </div>
                      )}
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
                          label: 'A 级意向',
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
                            onClick={() => toggleTaskDetail(l)}
                            className="px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                          >
                            <div className="flex items-center gap-3">
                            {expandedTaskId === l.id ? (
                              <ChevronDown className="w-4 h-4 text-blue-500 shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {l.name}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {l.source || '-'}
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
                                {formatDateTime(l.updated_at)?.split(' ')[0]}
                              </span>
                            )}
                            </div>
                            {expandedTaskId === l.id &&
                              (() => {
                                const detail = taskDetailCache[l.id];
                                const student = detail?.student || l;
                                const notes = detail?.notes || [];
                                return (
                                  <div className="mt-3 pl-7">
                                    {detail?.loading ? (
                                      <div className="py-4 flex justify-center">
                                        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                                      </div>
                                    ) : detail?.error ? (
                                      <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                        <span className="flex-1">{detail.error}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            loadTaskDetail(l);
                                          }}
                                          className="font-medium"
                                        >
                                          重试
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="border-l-4 border-blue-500 pl-3 space-y-3">
                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                                          {[
                                            ['region', '地域'],
                                            ['status', '状态'],
                                            ['intent_level', '意向'],
                                            ['stage', '阶段'],
                                            ['score', '成绩'],
                                            ['guardian_name', '监护人'],
                                            ['guardian_phone', '监护人电话'],
                                            ['school_name', '学校'],
                                          ].map(([key, label]) => (
                                            <div
                                              key={key}
                                              className="bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2 min-w-0"
                                            >
                                              <div className="text-xs text-gray-500">{label}</div>
                                              <div className="text-sm font-medium break-words mt-0.5">
                                                {student[key] || '-'}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                        <div>
                                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                                            最近联系记录
                                          </div>
                                          {detail?.notesError && (
                                            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg mb-2">
                                              联系记录加载失败：{detail.notesError}
                                            </div>
                                          )}
                                          {notes.length === 0 ? (
                                            <div className="text-xs text-gray-400 py-2">暂无联系记录</div>
                                          ) : (
                                            <div className="space-y-2">
                                              {notes.map((note) => (
                                                <div
                                                  key={note.id}
                                                  className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 px-3 py-2"
                                                >
                                                  <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                                                    <span className="font-medium text-gray-600 dark:text-gray-300">
                                                      {note.agent_name || '-'}
                                                    </span>
                                                    <span>{formatDateTime(note.created_at)}</span>
                                                  </div>
                                                  <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                                    {note.content}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
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

      {recycleAgent && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={closeRecycleModal}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                {recycleAgent.name} 的线索回收
              </h3>
              <button
                onClick={closeRecycleModal}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {recycleLoading ? (
                <div className="py-20 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                </div>
              ) : recycleStudents.length === 0 ? (
                <div className="py-20 text-center text-sm text-gray-400 dark:text-gray-500">
                  该话务员暂无可回收线索
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 w-12 text-left">
                        <input
                          ref={recycleAllCheckboxRef}
                          type="checkbox"
                          checked={
                            recycleStudents.length > 0 &&
                            recycleSelected.size === recycleStudents.length
                          }
                          onChange={toggleRecycleAll}
                          className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                        />
                      </th>
                      <th className="px-4 py-3 text-left font-medium">姓名</th>
                      <th className="px-4 py-3 text-left font-medium">地区</th>
                      <th className="px-4 py-3 text-left font-medium">意向</th>
                      <th className="px-4 py-3 text-left font-medium">状态</th>
                      <th className="px-4 py-3 text-left font-medium">最后活动时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {recycleStudents.map((item) => (
                      <tr
                        key={item.student_id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-900/30"
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={recycleSelected.has(item.student_id)}
                            onChange={() => toggleRecycleSelection(item.student_id)}
                            className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                          {item.name}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {item.region || '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {item.intent_level || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${adminRecycleStatusBadgeClass(item.status)}`}
                          >
                            {item.status || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {formatDateTime(item.last_activity_at || item.assigned_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {recycleSelected.size > 0 && (
              <div className="border-t dark:border-gray-700 px-5 py-4 bg-white dark:bg-gray-800 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="text-sm text-gray-600 dark:text-gray-400 lg:mr-auto">
                  已选 {recycleSelected.size} 条
                </div>
                <button
                  onClick={() => handleRecycleReassign('auto')}
                  disabled={recycleActionLoading}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {recycleActionLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="w-4 h-4" />
                  )}
                  自动均摊
                </button>
                <select
                  value={recycleAgentId}
                  onChange={(e) => setRecycleAgentId(e.target.value)}
                  className={`${inputCls} lg:w-56`}
                >
                  <option value="">选择坐席</option>
                  {activeAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => handleRecycleReassign('manual')}
                  disabled={recycleActionLoading || !recycleAgentId}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {recycleActionLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="w-4 h-4" />
                  )}
                  确认分配
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                {editingUser ? '编辑账号' : '添加账号'}
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
              {canGrantAdminPermissions && (
                <div>
                  <label
                    htmlFor="account-role"
                    className="block text-sm text-gray-600 dark:text-gray-400 mb-1"
                  >
                    角色
                  </label>
                  <select
                    id="account-role"
                    value={form.role}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        role: e.target.value,
                        is_super_admin: e.target.value === 'admin' ? form.is_super_admin : false,
                        page_permissions:
                          e.target.value === 'admin' ? form.page_permissions || [] : [],
                        operation_permissions:
                          e.target.value === 'admin' ? form.operation_permissions || [] : [],
                      })
                    }
                    className={inputCls}
                  >
                    <option value="agent">话务员</option>
                    <option value="admin">普通管理员</option>
                  </select>
                </div>
              )}
              {canGrantAdminPermissions && form.role === 'admin' && (
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={Boolean(form.is_super_admin)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        is_super_admin: e.target.checked,
                        page_permissions: e.target.checked ? [] : form.page_permissions || [],
                        operation_permissions: e.target.checked
                          ? []
                          : form.operation_permissions || [],
                      })
                    }
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  超级管理员
                </label>
              )}
              {canGrantAdminPermissions && form.role === 'admin' && !form.is_super_admin && (
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      页面权限
                    </div>
                    <div className="mt-2 space-y-2">
                      {ADMIN_PAGE_PERMISSION_OPTIONS.map((option) => (
                        <label
                          key={option.key}
                          className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
                        >
                          <input
                            type="checkbox"
                            checked={normalizeAdminPagePermissions(form.page_permissions).includes(
                              option.key,
                            )}
                            onChange={() => togglePagePermission(option.key)}
                            className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="min-w-0">
                            <span className="block font-medium">{option.label}</span>
                            <span className="block text-xs leading-5 text-gray-500 dark:text-gray-400">
                              {option.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      操作权限
                    </div>
                    <div className="mt-2 space-y-3">
                      {ADMIN_OPERATION_PERMISSION_OPTIONS.map((group) => (
                        <div key={group.group}>
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                            {group.group}
                          </div>
                          <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {group.items.map((option) => (
                              <label
                                key={option.key}
                                className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                              >
                                <input
                                  type="checkbox"
                                  checked={normalizeAdminOperationPermissions(
                                    form.operation_permissions,
                                  ).includes(option.key)}
                                  onChange={() => toggleOperationPermission(option.key)}
                                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {(!editingUser || canResetPasswords) && (
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
              )}
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
    </AdminLayout>
  );
}
