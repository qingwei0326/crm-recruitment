import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { formatDateTime, getApiErrorMessage } from '../../utils';
import { createIdempotencyKey } from '../../domain/handover';
import { adminRecycleStatusBadgeClass } from '../../labels';
import {
  ADMIN_OPERATION_PERMISSION_OPTIONS,
  ADMIN_OPERATION_PERMISSIONS,
  ADMIN_PAGE_PERMISSION_OPTIONS,
  canPerformAdminOperation,
  normalizeAdminOperationPermissions,
  normalizeAdminPagePermissions,
} from '../../adminPermissions';
import {
  employmentLabel,
  employmentStatus,
  getAgentListGroup,
  inputCls,
  isAdminAccount,
  isAgentAccount,
  isLocked,
  permissionSummary,
  roleLabel,
  validateDisplayName,
} from './agentManageUtils';
import EmploymentActions from './agents/EmploymentActions';
import EmploymentStatusBadge from './agents/EmploymentStatusBadge';
import {
  ArrowLeft,
  Users,
  UserPlus,
  Eye,
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
  KeyRound,
  ShieldCheck,
} from 'lucide-react';

export default function AgentManage() {
  const { dark, toggle } = useTheme();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();

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
  const startHandoverRequestRef = useRef(new Map());
  const [lifecycleActionId, setLifecycleActionId] = useState(null);

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
  const canStartHandover = canOffboardUsers && Boolean(user?.is_super_admin);
  const canEditAccount = (account) =>
    canEditUsers && (!isAdminAccount(account) || canGrantAdminPermissions);
  const canOperateAdminAccount = (account) => !isAdminAccount(account) || canGrantAdminPermissions;
  const canShowLifecycleAction = (account) => {
    if (!isAgentAccount(account)) return false;
    const status = employmentStatus(account);
    if (status === 'active') return canEditAccount(account) || canStartHandover;
    if (status === 'suspended') return canEditAccount(account);
    if (status === 'handover_pending') return canOffboardUsers;
    return false;
  };
  const hasAccountListActions = (account) =>
    canEditAccount(account)
    || (canUnlockUsers && canOperateAdminAccount(account) && isLocked(account))
    || (canAssignStudents
      && employmentStatus(account) === 'active'
      && isAgentAccount(account))
    || canShowLifecycleAction(account);
  const activeAgents = useMemo(
    () => agents.filter(
      (agent) => isAgentAccount(agent) && employmentStatus(agent) === 'active',
    ),
    [agents],
  );
  const agentFilterOptions = useMemo(
    () => [
      {
        key: 'active',
        label: '在职',
        count: agents.filter((agent) => employmentStatus(agent) === 'active').length,
      },
      {
        key: 'suspended',
        label: '暂停',
        count: agents.filter((agent) => employmentStatus(agent) === 'suspended').length,
      },
      {
        key: 'handover_pending',
        label: '待交接',
        count: agents.filter((agent) => employmentStatus(agent) === 'handover_pending').length,
      },
      {
        key: 'offboarded',
        label: '已离职',
        count: agents.filter((agent) => employmentStatus(agent) === 'offboarded').length,
      },
      { key: 'all', label: '全部', count: agents.length },
    ],
    [agents],
  );

  const visibleAgents = useMemo(() => {
    if (agentStatusFilter === 'all') {
      return agents;
    }
    return agents.filter((agent) => employmentStatus(agent) === agentStatusFilter);
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
    const currentStatus = employmentStatus(agent);
    if (!['active', 'suspended'].includes(currentStatus)) return;
    const suspending = currentStatus === 'active';
    if (suspending) {
      const ok = await confirm({
        title: `暂停「${agent.name}」`,
        message:
          '暂停后该话务员将无法登录系统，旧登录会立即失效。\n' +
          '不会回收线索，已分配学生仍保留在该账号名下。',
        confirmText: '暂停',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setLifecycleActionId(agent.id);
    try {
      const body = { is_active: !suspending };
      if (Number.isInteger(Number(agent.employment_version))) {
        body.expected_version = Number(agent.employment_version);
      }
      await api.put(`/admin/users/${agent.id}`, body);
      toast?.success(suspending ? '账号已暂停' : '账号已恢复');
      fetchAgents();
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
      if (error.response?.status === 409) fetchAgents();
    } finally {
      setLifecycleActionId(null);
    }
  };

  const handleStartHandover = async (agent) => {
    const ok = await confirm({
      title: `为「${agent.name}」办理离职`,
      message:
        `· 学生状态、意向、阶段、跟进记录和来源进度全部原样保留\n` +
        `· 非终态学生进入待交接，可分批转给新员工或一次接手\n` +
        `· 已报名和无效记录保留历史归因，不会重新回收\n` +
        `· 账号会立即停用，旧登录会话同步失效`,
      confirmText: '开始交接',
      tone: 'danger',
    });
    if (!ok) return;

    let request = startHandoverRequestRef.current.get(agent.id);
    if (!request) {
      request = {
        expected_version: Number(agent.employment_version || 0),
        idempotency_key: createIdempotencyKey(agent.id),
      };
      startHandoverRequestRef.current.set(agent.id, request);
    }
    setLifecycleActionId(agent.id);
    try {
      const res = await api.post(`/admin/users/${agent.id}/offboarding/start`, request);
      const d = res.data?.data;
      if (!d?.id) throw new Error(res.data?.msg || '开始交接失败');
      startHandoverRequestRef.current.delete(agent.id);
      toast?.success(`${agent.name} 已进入交接，待处理 ${d.remaining_items || 0} 条`);
      fetchAgents();
      if (selectedAgent?.id === agent.id) setSelectedAgent(null);
      navigate(`/admin/handovers?batch=${d.id}`);
    } catch (err) {
      if (err.response) {
        startHandoverRequestRef.current.delete(agent.id);
      }
      toast?.error(getApiErrorMessage(err));
      if (err.response?.status === 409) fetchAgents();
    } finally {
      setLifecycleActionId(null);
    }
  };

  const handleOpenBatch = async (agent) => {
    setLifecycleActionId(agent.id);
    try {
      const res = await api.get('/admin/handovers', {
        params: { q: agent.username, page: 1, page_size: 200 },
      });
      const batch = (res.data?.data?.list || []).find(
        (item) => item.source_agent?.id === agent.id && item.status !== 'completed',
      );
      if (!batch) throw new Error('未找到该员工的待交接批次');
      navigate(`/admin/handovers?batch=${batch.id}`);
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setLifecycleActionId(null);
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
      const newPassword = res.data?.data?.new_password;
      const successMessage =
        res.data?.msg && res.data.msg !== 'ok'
          ? res.data.msg
          : newPassword
            ? `用户 ${agent.name} 密码已重置为 ${newPassword}`
            : '密码已重置';
      toast?.success(successMessage);
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
              type="button"
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
              type="button"
              onClick={toggle}
              aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
              title={dark ? '切换到浅色模式' : '切换到深色模式'}
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

        <div className="mx-auto w-full max-w-[1600px] p-3 sm:p-4 lg:p-6">
          <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-6">
            {/* Agent list — on mobile, show as full-width when no agent selected, hidden when viewing tasks */}
            <div className={`${isMobile && selectedAgent ? 'hidden' : ''} lg:sticky lg:top-[4.75rem] lg:self-start`}>
              <div className="overflow-hidden rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="border-b bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                      <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      账号列表 ({visibleAgents.length})
                    </h3>
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                      共 {agents.length}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-900/60" aria-label="员工状态筛选">
                    {agentFilterOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        aria-label={`${option.label} ${option.count}`}
                        aria-pressed={agentStatusFilter === option.key}
                        onClick={() => {
                          setAgentStatusFilter(option.key);
                          setSelectedAgent(null);
                        }}
                        className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-md px-1 py-1 text-[11px] leading-4 transition-colors ${
                          agentStatusFilter === option.key
                            ? 'bg-white font-semibold text-blue-700 shadow-sm dark:bg-gray-700 dark:text-blue-300'
                            : 'text-gray-500 hover:bg-white/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/70 dark:hover:text-gray-200'
                        }`}
                      >
                        <span className="whitespace-nowrap">{option.label}</span>
                        <span className="font-mono text-[10px] opacity-80">{option.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-[calc(100dvh-11.5rem)] divide-y overflow-y-auto overscroll-contain dark:divide-gray-700 lg:max-h-[calc(100dvh-11rem)]">
                  {loading ? (
                    <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                      加载中...
                    </div>
                  ) : sortedAgents.length === 0 ? (
                    <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                      {agentStatusFilter === 'all'
                        ? '暂无账号'
                        : `暂无${employmentLabel(agentStatusFilter)}账号`}
                    </div>
                  ) : (
                    sortedAgents.map((a) => (
                      <div
                        key={a.id}
                        onClick={() => viewAgentTasks(a)}
                        className={`cursor-pointer px-3 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/70 ${selectedAgent?.id === a.id ? 'border-l-2 border-l-blue-500 bg-blue-50 dark:bg-blue-900/20' : ''}`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                            <span className="max-w-[10rem] truncate">{a.name}</span>
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                              {roleLabel(a)}
                            </span>
                            <EmploymentStatusBadge account={a} />
                            {isLocked(a) && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                                <Lock className="h-3 w-3" />
                                已锁定
                              </span>
                            )}
                          </div>
                          <div className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                            @{a.username}
                          </div>
                          {permissionSummary(a) && (
                            <div className="mt-1 truncate text-xs text-gray-400 dark:text-gray-500" title={permissionSummary(a)}>
                              {permissionSummary(a)}
                            </div>
                          )}
                        </div>
                        {isAgentAccount(a) && (
                          <div className="mt-2 grid grid-cols-3 rounded-md border border-gray-100 bg-gray-50/70 py-1.5 text-center text-xs text-gray-500 dark:border-gray-700/60 dark:bg-gray-900/30 dark:text-gray-400">
                            <span className="flex items-center justify-center gap-1" title="总任务">
                              <Target className="h-3 w-3" />
                              <span className="font-mono">{a.total_tasks ?? 0}</span>
                            </span>
                            <span className="flex items-center justify-center gap-1 border-x border-gray-200 dark:border-gray-700" title="已完成">
                              <CheckCircle2 className="h-3 w-3" />
                              <span className="font-mono">{a.done_tasks ?? 0}</span>
                            </span>
                            <span className="flex items-center justify-center gap-1" title="今日拨号">
                              <Phone className="h-3 w-3" />
                              <span className="font-mono">{a.today_calls ?? 0}</span>
                            </span>
                          </div>
                        )}
                        {hasAccountListActions(a) && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-700/70">
                            {canUnlockUsers && canOperateAdminAccount(a) && isLocked(a) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUnlock(a);
                                }}
                                title="解锁账号（清除登录失败锁定）"
                                className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-orange-300 px-2 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-900/20"
                              >
                                <Unlock className="h-3.5 w-3.5" />
                                解锁
                              </button>
                            )}
                            {canEditAccount(a) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditModal(a);
                                }}
                                title={`编辑 ${a.name}`}
                                aria-label={`编辑 ${a.name}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canAssignStudents
                              && employmentStatus(a) === 'active'
                              && isAgentAccount(a) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openRecycleModal(a);
                                }}
                                className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-amber-300 px-2 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/20"
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5" />
                                回收
                              </button>
                            )}
                            {isAgentAccount(a) && (
                              <EmploymentActions
                                account={a}
                                disabled={lifecycleActionId === a.id}
                                onSuspend={
                                  canEditAccount(a)
                                    ? (event) => {
                                        event.stopPropagation();
                                        handleToggleActive(a);
                                      }
                                    : undefined
                                }
                                onResume={
                                  canEditAccount(a)
                                    ? (event) => {
                                        event.stopPropagation();
                                        handleToggleActive(a);
                                      }
                                    : undefined
                                }
                                onStartHandover={
                                  canStartHandover
                                    ? (event) => {
                                        event.stopPropagation();
                                        handleStartHandover(a);
                                      }
                                    : undefined
                                }
                                onOpenBatch={
                                  canOffboardUsers
                                    ? (event) => {
                                        event.stopPropagation();
                                        handleOpenBatch(a);
                                      }
                                    : undefined
                                }
                              />
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Task detail — on mobile, full screen when viewing */}
            <div className={`min-w-0 ${isMobile && !selectedAgent ? 'hidden' : ''}`}>
              {/* Mobile back button */}
              {isMobile && selectedAgent && (
                <button
                  onClick={() => setSelectedAgent(null)}
                  className="mb-3 inline-flex min-h-10 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-blue-600 dark:border-gray-700 dark:bg-gray-800 dark:text-blue-400"
                >
                  <ArrowLeft className="w-4 h-4" /> 返回列表
                </button>
              )}

              {!selectedAgent ? (
                <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-lg border bg-white py-20 text-gray-300 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-600">
                  <Eye className="w-12 h-12 mb-3" />
                  <p className="text-sm">未选择账号</p>
                </div>
              ) : taskLoading ? (
                <div className="flex min-h-[24rem] items-center justify-center rounded-lg border bg-white py-20 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                </div>
              ) : !isAgentAccount(selectedAgent) ? (
                <div className="rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex flex-col gap-4 border-b px-4 py-4 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between lg:px-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                        {selectedAgent.name}
                        </h3>
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          {roleLabel(selectedAgent)}
                        </span>
                        <EmploymentStatusBadge account={selectedAgent} />
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                        @{selectedAgent.username}
                      </p>
                      {permissionSummary(selectedAgent) && (
                        <p className="mt-2 max-w-3xl text-xs leading-5 text-gray-500 dark:text-gray-400">
                          {permissionSummary(selectedAgent)}
                        </p>
                      )}
                    </div>
                    {(canEditAccount(selectedAgent)
                      || (canResetPasswords && canOperateAdminAccount(selectedAgent))) && (
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {canEditAccount(selectedAgent) && (
                          <button
                            onClick={() => openEditModal(selectedAgent)}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            编辑
                          </button>
                        )}
                        {canResetPasswords && canOperateAdminAccount(selectedAgent) && (
                          <button
                            onClick={() => handleResetPassword(selectedAgent)}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/20"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            重置密码
                          </button>
                        )}
                        {canEditAccount(selectedAgent)
                          && ['active', 'suspended'].includes(employmentStatus(selectedAgent)) && (
                          <button
                            onClick={() => handleToggleActive(selectedAgent)}
                            className={`min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium ${employmentStatus(selectedAgent) === 'active' ? 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/20' : 'border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-900/20'}`}
                          >
                            {employmentStatus(selectedAgent) === 'active' ? '暂停' : '恢复'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 p-4 sm:grid-cols-3 lg:p-5">
                    <div className="rounded-lg border-l-2 border-gray-200 bg-gray-50/70 px-3 py-2 dark:border-gray-600 dark:bg-gray-900/30">
                      <div className="text-xs text-gray-500 dark:text-gray-400">状态</div>
                      <div className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-100">
                        {employmentLabel(selectedAgent)}
                      </div>
                    </div>
                    <div className="rounded-lg border-l-2 border-blue-300 bg-gray-50/70 px-3 py-2 dark:border-blue-800 dark:bg-gray-900/30">
                      <div className="text-xs text-gray-500 dark:text-gray-400">权限</div>
                      <div className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-100">
                        {roleLabel(selectedAgent)}
                      </div>
                    </div>
                    <div className="rounded-lg border-l-2 border-gray-200 bg-gray-50/70 px-3 py-2 dark:border-gray-600 dark:bg-gray-900/30">
                      <div className="text-xs text-gray-500 dark:text-gray-400">创建时间</div>
                      <div className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-100">
                        {formatDateTime(selectedAgent.created_at) || '-'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : agentTasks ? (
                <div className="space-y-4">
                  <div className="rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                    <div className="flex flex-col gap-4 border-b px-4 py-4 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between lg:px-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                            {agentTasks.agent.name}
                          </h3>
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            {roleLabel(selectedAgent)}
                          </span>
                          <EmploymentStatusBadge account={selectedAgent} />
                        </div>
                        <p className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                          @{agentTasks.agent.username}
                        </p>
                      </div>
                      {(canEditAccount(selectedAgent)
                        || (canResetPasswords && canOperateAdminAccount(selectedAgent))
                        || (canUnlockUsers && canOperateAdminAccount(selectedAgent))
                        || canAssignStudents
                        || canOffboardUsers) && (
                        <div className="flex flex-wrap gap-2 sm:justify-end">
                          {canEditAccount(selectedAgent) && (
                            <button
                              onClick={() => openEditModal(selectedAgent)}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              编辑
                            </button>
                          )}
                          {canResetPasswords && canOperateAdminAccount(selectedAgent) && (
                            <button
                              onClick={() => handleResetPassword(selectedAgent)}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/20"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              重置密码
                            </button>
                          )}
                          {canUnlockUsers && canOperateAdminAccount(selectedAgent) && isLocked(selectedAgent) && (
                            <button
                              onClick={() => handleUnlock(selectedAgent)}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-orange-300 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900/20"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              解锁
                            </button>
                          )}
                          {canAssignStudents && employmentStatus(selectedAgent) === 'active' && (
                            <button
                              onClick={() => openRecycleModal(selectedAgent)}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/20"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              回收
                            </button>
                          )}
                          <EmploymentActions
                            account={selectedAgent}
                            disabled={lifecycleActionId === selectedAgent.id}
                            onSuspend={
                              canEditAccount(selectedAgent)
                                ? () => handleToggleActive(selectedAgent)
                                : undefined
                            }
                            onResume={
                              canEditAccount(selectedAgent)
                                ? () => handleToggleActive(selectedAgent)
                                : undefined
                            }
                            onStartHandover={
                              canStartHandover
                                ? () => handleStartHandover(selectedAgent)
                                : undefined
                            }
                            onOpenBatch={
                              canOffboardUsers
                                ? () => handleOpenBatch(selectedAgent)
                                : undefined
                            }
                          />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 xl:grid-cols-7 lg:p-5">
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
                          className="min-w-0 rounded-lg border-l-2 border-gray-200 bg-gray-50/70 px-2 py-2 text-center dark:border-gray-600 dark:bg-gray-900/30"
                        >
                          <div className={`truncate text-lg font-bold tracking-tight ${s.color}`}>{s.value}</div>
                          <div className="truncate text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                    <div className="border-b bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                        任务列表 ({agentTasks.list.length})
                      </h4>
                    </div>
                    <div className="max-h-[60dvh] divide-y overflow-y-auto overscroll-contain dark:divide-gray-700 lg:max-h-[calc(100dvh-24rem)]">
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-[1px] sm:p-4"
          onClick={closeRecycleModal}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b px-4 py-3.5 dark:border-gray-700 sm:px-5">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
                  {recycleAgent.name} 的线索回收
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {recycleLoading ? '正在读取可回收线索' : `共 ${recycleStudents.length} 条可回收线索`}
                </p>
              </div>
              <button
                onClick={closeRecycleModal}
                aria-label="关闭线索回收"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <X className="h-5 w-5" />
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
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="sticky top-0 border-b bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
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
              <div className="flex flex-col gap-3 border-t bg-white px-4 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))] dark:border-gray-700 dark:bg-gray-800 lg:flex-row lg:items-center lg:px-5">
                <div className="text-sm text-gray-600 dark:text-gray-400 lg:mr-auto">
                  已选 <span className="font-semibold text-gray-900 dark:text-gray-100">{recycleSelected.size}</span> 条
                </div>
                <button
                  onClick={() => handleRecycleReassign('auto')}
                  disabled={recycleActionLoading}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-green-600 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 dark:border-green-700 dark:text-green-300 dark:hover:bg-green-900/20"
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
                  aria-label="目标坐席"
                  className={`${inputCls} min-h-10 lg:w-56`}
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
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-[1px] sm:p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b px-4 py-3.5 dark:border-gray-700 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
                    {editingUser ? '编辑账号' : '添加账号'}
                  </h3>
                  {editingUser && (
                    <p className="mt-0.5 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                      @{editingUser.username}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                aria-label="关闭账号编辑"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {!editingUser && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
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
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">姓名</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputCls}
                    placeholder="显示名称"
                  />
                </div>
                {canGrantAdminPermissions && !editingUser && (
                  <div>
                  <label
                    htmlFor="account-role"
                    className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400"
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
                {canGrantAdminPermissions && editingUser && (
                  <div>
                    <div className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                      角色
                    </div>
                    <div className={`${inputCls} flex items-center justify-between gap-2 bg-gray-50 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300`}>
                      <span>{roleLabel(editingUser)}</span>
                      <span className="text-xs text-gray-400">创建后不可修改</span>
                    </div>
                  </div>
                )}
                {(!editingUser || canResetPasswords) && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
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
              </div>

              {canGrantAdminPermissions && form.role === 'admin' && (
                <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${form.is_super_admin ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' : 'border-gray-200 bg-gray-50/70 text-gray-700 hover:border-blue-300 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-300'}`}>
                  <input
                    type="checkbox"
                    aria-label="超级管理员"
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
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">超级管理员</span>
                    <span className="mt-0.5 block text-xs leading-5 opacity-75">
                      拥有全部页面和操作权限，启用后无需单独勾选权限。
                    </span>
                  </span>
                </label>
              )}

              {canGrantAdminPermissions && form.role === 'admin' && !form.is_super_admin && (
                <div className="space-y-4 border-t border-gray-100 pt-5 dark:border-gray-700/70">
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="border-b bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-100">
                      页面权限
                    </div>
                    <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
                      {ADMIN_PAGE_PERMISSION_OPTIONS.map((option) => (
                        <label
                          key={option.key}
                          className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm transition-colors ${normalizeAdminPagePermissions(form.page_permissions).includes(option.key) ? 'border-blue-300 bg-blue-50/70 text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200' : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40'}`}
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
                            <span className="mt-0.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                              {option.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="border-b bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-100">
                      操作权限
                    </div>
                    <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                      {ADMIN_OPERATION_PERMISSION_OPTIONS.map((group) => (
                        <div key={group.group} className="rounded-md border border-gray-200 p-2.5 dark:border-gray-700">
                          <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                            {group.group}
                          </div>
                          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-1 2xl:grid-cols-2">
                            {group.items.map((option) => (
                              <label
                                key={option.key}
                                className={`flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors ${normalizeAdminOperationPermissions(form.operation_permissions).includes(option.key) ? 'bg-blue-50 font-medium text-blue-800 dark:bg-blue-950/40 dark:text-blue-200' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50'}`}
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
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  {formError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t bg-white px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] dark:border-gray-700 dark:bg-gray-800 sm:px-5">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="min-h-10 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex min-h-10 min-w-28 items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
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
