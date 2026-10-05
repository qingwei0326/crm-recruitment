import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import logger from '../../utils/logger';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import {
  AdminPageContainer,
  AdminPageIntro,
  AdminSurface,
  adminPageMainClass,
} from '../../components/admin/AdminPagePrimitives';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { stageLabel, statusLabel, STAGES } from '../../labels';
import { buildStudentPayload, getApiErrorMessage } from '../../utils';
import {
  INTENT_OPTS,
  STAGE_STAT_KEYS,
  STATUS_DETAIL_OPTS,
  STATUS_OPTS,
  emptyStudentForm,
  getAssignedToFromOwnershipFilter,
  getOwnershipFilterFromParams,
  inputCls,
} from './leadsManageUtils';
import {
  ADMIN_PAGE_PERMISSIONS,
  ADMIN_OPERATION_PERMISSIONS,
  canAccessAdminPage,
  canPerformAdminOperation,
} from '../../adminPermissions';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  FileUp,
  X,
  CheckSquare,
  Square,
  Plus,
  Loader2,
  Sun,
  Moon,
  MapPin,
  AlertTriangle,
  Wand2,
} from 'lucide-react';
import LeadsExpandPanel from './leads/LeadsExpandPanel';
import LeadsImportModal from './leads/LeadsImportModal';
import LeadsCreateModal from './leads/LeadsCreateModal';
import LeadsAssignModal from './leads/LeadsAssignModal';
import LeadsEditModal from './leads/LeadsEditModal';
import LeadsEnrollmentModal from './leads/LeadsEnrollmentModal';
import LeadsSchoolAssignModal from './leads/LeadsSchoolAssignModal';
import LeadsMobileCard from './leads/LeadsMobileCard';
import LeadsTableRow from './leads/LeadsTableRow';

export default function LeadsManage() {
  const { user } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const searchParamString = searchParams.toString();
  const navigate = useNavigate();
  const [autoAssigning, setAutoAssigning] = useState(false);
  const canCreateStudent = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentCreate);
  const canEditStudent = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentEdit);
  const canDeleteStudent = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentDelete);
  const canInvalidateEnrolled = canPerformAdminOperation(
    user,
    ADMIN_OPERATION_PERMISSIONS.enrolledInvalidate,
  );
  const canImportStudents = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentImport);
  const canAssignStudents = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentAssign);
  const canViewStudentPhone = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentPhone);
  const canCreateEnrollment =
    canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.enrollmentSettlement)
    && canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.enrollmentCreate);
  const canManageHomeVisits = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.homeVisits);
  const canManageCampusVisits = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.campusVisits);

  const [students, setStudents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [statusDetail, setStatusDetail] = useState(searchParams.get('status_detail') || '');
  const [region, setRegion] = useState(searchParams.get('region') || '');
  const [stage, setStage] = useState(searchParams.get('stage') || '');
  const [intent, setIntent] = useState(searchParams.get('intent') || '');
  const [assignmentFilter, setAssignmentFilter] = useState(getOwnershipFilterFromParams(searchParams));
  const [needHelp, setNeedHelp] = useState(searchParams.get('need_help') === '1');
  const [activeOnly, setActiveOnly] = useState(searchParams.get('active') === '1');
  const [todayAOnly, setTodayAOnly] = useState(searchParams.get('today_a') === '1');
  const [missingPhoneOnly, setMissingPhoneOnly] = useState(searchParams.get('missing_phone') === '1');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const pageSize = 15;

  // Modal flags
  const [showImport, setShowImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  // Expand
  const [expandedId, setExpandedId] = useState(null);
  const [expandCache, setExpandCache] = useState({});

  // Agents & stats
  const [agents, setAgents] = useState([]);
  const [stageStats, setStageStats] = useState({});

  // Import
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  // Create
  const [newStudent, setNewStudent] = useState(emptyStudentForm);
  const [createErr, setCreateErr] = useState('');

  // Assign
  const [assignAgentId, setAssignAgentId] = useState('');
  const [assignOverrideReason, setAssignOverrideReason] = useState('');

  // School assign
  const [showSchoolAssign, setShowSchoolAssign] = useState(false);
  const [schools, setSchools] = useState([]);
  const [dispatchRegions, setDispatchRegions] = useState([]);
  const [schoolAssignRegions, setSchoolAssignRegions] = useState([]);
  const [schoolAssignSchool, setSchoolAssignSchool] = useState('');
  const [schoolAssignAgents, setSchoolAssignAgents] = useState([]);
  const [schoolAssignLoading, setSchoolAssignLoading] = useState(false);
  const [schoolListLoading, setSchoolListLoading] = useState(false);
  const schoolsReqIdRef = useRef(0);

  // Inline note
  const [noteText, setNoteText] = useState({});
  const [followUpDate, setFollowUpDate] = useState({});
  const [homeSubmittingId, setHomeSubmittingId] = useState(null);
  const [campusSubmittingId, setCampusSubmittingId] = useState(null);
  const [enrollmentStudent, setEnrollmentStudent] = useState(null);
  const [enrollmentForm, setEnrollmentForm] = useState({
    enrolled_program: '',
    amount: '',
    tuition_list_amount: '',
    student_subsidy_amount: '',
    student_paid_amount: '',
    external_subsidy_amount: '',
    commission_base_amount: '',
    commission_subsidy_amount: '',
    enrolled_at: '',
  });
  const [enrollmentSubmitting, setEnrollmentSubmitting] = useState(false);

  // Edit modal
  const [editStudent, setEditStudent] = useState(null);

  const selectedStudents = students.filter((student) => selected.has(student.id));
  const selectedEnrolledStudents = selectedStudents.filter(
    (student) => student.status === '已报名' || student.stage === '已报名',
  );
  const selectedAgent = agents.find((agent) => String(agent.id) === String(assignAgentId));
  const selectedAssignmentAgentId = getAssignedToFromOwnershipFilter(assignmentFilter);
  const selectedAssignmentAgent = agents.find((agent) => String(agent.id) === selectedAssignmentAgentId);

  const fetchStudents = useCallback(
    (p, overrides = {}) => {
      setLoading(true);
      const filters = {
        q,
        status,
        statusDetail,
        region,
        stage,
        intent,
        assignment: assignmentFilter,
        needHelp,
        activeOnly,
        todayAOnly,
        missingPhoneOnly,
        ...overrides,
      };
      const params = { page: p || page, page_size: pageSize };
      if (filters.q) params.q = filters.q;
      if (filters.status) params.status = filters.status;
      if (filters.statusDetail) params.status_detail = filters.statusDetail;
      if (filters.region) params.region = filters.region;
      if (filters.stage) params.stage = filters.stage;
      if (filters.intent) params.intent_level = filters.intent;
      if (filters.assignment === 'unassigned') params.assignment = 'unassigned';
      const assignedTo = getAssignedToFromOwnershipFilter(filters.assignment);
      if (assignedTo) params.assigned_to = assignedTo;
      if (filters.needHelp) params.need_help = '1';
      if (filters.activeOnly) params.active = '1';
      if (filters.todayAOnly) params.today_a = '1';
      if (filters.missingPhoneOnly) params.missing_phone = '1';
      api
        .get('/students', { params })
        .then((res) => {
          setStudents(res.data.data?.list || []);
          setTotal(res.data.data?.total || 0);
          setSelected(new Set());
        })
        .catch(() => { toast?.error('数据加载失败'); })
        .finally(() => setLoading(false));
    },
    [page, pageSize, q, status, statusDetail, region, stage, intent, assignmentFilter, needHelp, activeOnly, todayAOnly, missingPhoneOnly, toast],
  );

  useEffect(() => {
    fetchStudents(1);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, statusDetail, region, stage, intent, assignmentFilter, needHelp, activeOnly, todayAOnly, missingPhoneOnly]);

  useEffect(() => {
    setQ(searchParams.get('q') || '');
    setStatus(searchParams.get('status') || '');
    setStatusDetail(searchParams.get('status_detail') || '');
    setRegion(searchParams.get('region') || '');
    setStage(searchParams.get('stage') || '');
    setIntent(searchParams.get('intent') || '');
    setAssignmentFilter(getOwnershipFilterFromParams(searchParams));
    setNeedHelp(searchParams.get('need_help') === '1');
    setActiveOnly(searchParams.get('active') === '1');
    setTodayAOnly(searchParams.get('today_a') === '1');
    setMissingPhoneOnly(searchParams.get('missing_phone') === '1');
  }, [searchParamString]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/admin/agents').then((r) => setAgents(r.data.data || [])).catch((e) => logger.error('加载话务员列表失败:', e));
    api.get('/stats/stages').then((r) => setStageStats(r.data.data || {})).catch((e) => logger.error('加载阶段统计失败:', e));
  }, []);

  useEffect(() => {
    if (!showSchoolAssign) return;
    if (schoolAssignRegions.length === 0) {
      setSchools([]);
      setSchoolAssignSchool('');
      return;
    }
    const reqId = ++schoolsReqIdRef.current;
    setSchoolListLoading(true);
    const params = new URLSearchParams();
    schoolAssignRegions.forEach((r) => params.append('regions', r));
    api
      .get(`/students/schools?${params.toString()}`)
      .then((res) => {
        if (reqId !== schoolsReqIdRef.current) return;
        if (res.data.code === 0) {
          const list = res.data.data || [];
          setSchools(list);
          setSchoolAssignSchool((prev) => (list.find((s) => s.name === prev) ? prev : ''));
        }
      })
      .catch((e) => {
        if (reqId === schoolsReqIdRef.current) {
          toast?.error('学校列表加载失败: ' + getApiErrorMessage(e));
        }
      })
      .finally(() => {
        if (reqId === schoolsReqIdRef.current) setSchoolListLoading(false);
      });
  }, [showSchoolAssign, schoolAssignRegions, toast]);

  const loadExpandData = async (id, { force = false } = {}) => {
    setExpandCache((prev) => {
      const current = prev[id];
      if (!force && current && !current.error) return prev;
      return { ...prev, [id]: { loading: true } };
    });
    try {
      const [studentResult, notesResult] = await Promise.allSettled([
        api.get(`/students/${id}`),
        api.get(`/notes?student_id=${id}`),
      ]);
      if (studentResult.status === 'rejected') {
        throw studentResult.reason;
      }

      setExpandCache((prev) => ({
        ...prev,
        [id]: {
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
      setExpandCache((prev) => ({
        ...prev,
        [id]: {
          error: getApiErrorMessage(error),
        },
      }));
    }
  };

  const toggleExpand = (id) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      if (!expandCache[id]) loadExpandData(id);
    }
  };

  const refreshExpand = () => {
    if (expandedId) loadExpandData(expandedId, { force: true });
  };

  const clearSingleFilter = (key) => {
    if (key === 'q') {
      setQ('');
      setPage(1);
      fetchStudents(1, { q: '' });
      return;
    }
    if (key === 'status') setStatus('');
    if (key === 'statusDetail') setStatusDetail('');
    if (key === 'region') setRegion('');
    if (key === 'stage') setStage('');
    if (key === 'intent') setIntent('');
    if (key === 'assignment') setAssignmentFilter('');
    if (key === 'needHelp') setNeedHelp(false);
    if (key === 'activeOnly') setActiveOnly(false);
    if (key === 'todayAOnly') setTodayAOnly(false);
    if (key === 'missingPhoneOnly') setMissingPhoneOnly(false);
  };

  const clearAllFilters = () => {
    setQ('');
    setStatus('');
    setStatusDetail('');
    setRegion('');
    setStage('');
    setIntent('');
    setAssignmentFilter('');
    setNeedHelp(false);
    setActiveOnly(false);
    setTodayAOnly(false);
    setMissingPhoneOnly(false);
    setPage(1);
    fetchStudents(1, {
      q: '',
      status: '',
      statusDetail: '',
      region: '',
      stage: '',
      intent: '',
      assignment: '',
      needHelp: false,
      activeOnly: false,
      todayAOnly: false,
      missingPhoneOnly: false,
    });
    if (searchParamString) navigate('/admin/leads', { replace: true });
  };

  const activeFilterChips = [
    q.trim() && { key: 'q', label: `搜索：${q.trim()}` },
    assignmentFilter === 'unassigned'
      ? { key: 'assignment', label: '未分配' }
      : selectedAssignmentAgentId && {
        key: 'assignment',
        label: `归属：${selectedAssignmentAgent?.name || `话务员 ${selectedAssignmentAgentId}`}`,
      },
    region && { key: 'region', label: `区县：${region}` },
    stage && { key: 'stage', label: `阶段：${stageLabel(stage)}` },
    status && { key: 'status', label: `状态：${statusLabel(status)}` },
    statusDetail && { key: 'statusDetail', label: `结果：${statusDetail}` },
    intent && { key: 'intent', label: `意向：${intent}` },
    needHelp && { key: 'needHelp', label: '需协助' },
    activeOnly && { key: 'activeOnly', label: '仍需跟进' },
    todayAOnly && { key: 'todayAOnly', label: '今日新增 A' },
    missingPhoneOnly && { key: 'missingPhoneOnly', label: '无电话数据' },
  ].filter(Boolean);
  const showGlobalStageStats =
    activeFilterChips.length === 0 && Object.keys(stageStats).length > 0;
  const unassignedLeadCount = stageStats['未分配'] || 0;
  const assignedNewLeadCount = stageStats['初次联系'] || 0;
  const inProgressLeadCount = STAGE_STAT_KEYS.filter((s) => !['初次联系', '已报名'].includes(s))
    .reduce((sum, s) => sum + (stageStats[s] || 0), 0);
  const enrolledLeadCount = stageStats['已报名'] || 0;

  const handleSearch = (e) => {
    e.preventDefault();
    fetchStudents(1);
    setPage(1);
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  const toggleSel = (id) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };
  const toggleAll = () =>
    setSelected(selected.size === students.length ? new Set() : new Set(students.map((l) => l.id)));

  // ── Actions ──
  const handleImport = async () => {
    if (!canImportStudents) return;
    if (!importFile) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      const res = await api.post('/students/import', fd);
      setImportResult(res.data.data);
      if (res.data.code === 0) fetchStudents(page);
    } catch {
      setImportResult({ success: 0 });
    } finally {
      setImporting(false);
    }
  };

  const handleCreate = async () => {
    if (!canCreateStudent) return;
    if (!newStudent.name) return setCreateErr('????');
    try {
      const res = await api.post('/students', buildStudentPayload(newStudent));
      if (res.data.code === 0) {
        setShowCreate(false);
        setNewStudent(emptyStudentForm);
        fetchStudents(page);
      } else setCreateErr(res.data.msg);
    } catch (e) {
      setCreateErr(getApiErrorMessage(e) || '创建失败');
    }
  };

  const handleAssign = async () => {
    if (!canAssignStudents) return;
    if (selected.size === 0 || !assignAgentId) return;
    if (selectedEnrolledStudents.length > 0) {
      toast?.error('已报名学生不能重新分配，请先取消选择已报名记录');
      return;
    }
    const sample = selectedStudents.slice(0, 5).map((student) => student.name || `学生 ${student.id}`).join('、');
    const ok = await confirm({
      title: '确认批量分配',
      message:
        `将 ${selected.size} 名学生分配给「${selectedAgent?.name || assignAgentId}」。\n` +
        `样例：${sample}${selectedStudents.length > 5 ? ' 等' : ''}\n` +
        '已报名学生会被系统拒绝，请确认当前选择无误。',
      confirmText: '确认分配',
    });
    if (!ok) return;
    const payload = { student_ids: [...selected], agent_id: parseInt(assignAgentId) };
    if (user?.is_super_admin && assignOverrideReason.trim()) {
      payload.override_reason = assignOverrideReason.trim();
    }
    await api.post('/students/assign', payload);
    setShowAssign(false);
    setAssignOverrideReason('');
    fetchStudents(page);
    refreshExpand();
  };

  const handleAutoAssign = async () => {
    if (!canAssignStudents) return;
    const ok = await confirm({
      title: '自动均摊未分配线索',
      message:
        '把当前所有「未分配」的学生，按各话务员现有在跟数量从少到多自动均摊。\n' +
        '只影响未分配且未报名/未无效的线索，不会动已分配或已报名数据。',
      confirmText: '开始均摊',
    });
    if (!ok) return;
    setAutoAssigning(true);
    try {
      const res = await api.post('/students/auto-assign');
      if (res.data.code === 0) {
        const d = res.data.data;
        if (!d.total_assigned) {
          toast?.info(d.message || '没有未分配的学生');
        } else {
          const detail = (d.distribution || [])
            .map((x) => `${x.name} +${x.count}`)
            .join('、');
          const overflow = d.overflow_count ? `，${d.overflow_count} 名留在未分配池` : '';
          toast?.success(`已自动分配 ${d.total_assigned} 名${overflow}：${detail}`);
          fetchStudents(page);
          refreshExpand();
        }
      } else {
        toast?.error(res.data.msg || '自动分配失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setAutoAssigning(false);
    }
  };

  const handleRegionAssign = async () => {
    if (!canAssignStudents) return;
    setSchoolAssignSchool('');
    setSchoolAssignAgents([]);
    setSchoolAssignRegions([]);
    setSchools([]);
    setDispatchRegions([]);
    setShowSchoolAssign(true);
    setSchoolAssignLoading(true);
    try {
      const res = await api.get('/students/dispatch-regions');
      if (res.data.code === 0) {
        setDispatchRegions(res.data.data || []);
      }
    } catch (e) {
      toast?.error('区县列表加载失败: ' + getApiErrorMessage(e));
    } finally {
      setSchoolAssignLoading(false);
    }
  };

  const handleSchoolAssign = async () => {
    if (!canAssignStudents) return;
    if (schoolAssignRegions.length === 0) return toast?.warning('请先选择区县');
    if (!schoolAssignSchool) return toast?.warning('请选择学校');
    if (schoolAssignAgents.length === 0) return toast?.warning('请选择至少一个话务员');
    const ok = await confirm({
      title: '确认学校分发',
      message:
        `学校：${schoolAssignSchool}\n` +
        `区县：${schoolAssignRegions.join('、')}\n` +
        `话务员：${schoolAssignAgents.length} 人\n` +
        '只会分发未分配且未报名/未无效的线索。',
      confirmText: '确认分发',
    });
    if (!ok) return;
    const res = await api.post('/students/school-assign', {
      school_name: schoolAssignSchool,
      regions: schoolAssignRegions,
      agent_ids: schoolAssignAgents,
    });
    if (res.data.code === 0) {
      const overflow = res.data.data.overflow_count
        ? `，${res.data.data.overflow_count} 名留在未分配池`
        : '';
      toast?.success(`分发完成：${res.data.data.total_assigned} 名学生${overflow}`);
      setShowSchoolAssign(false);
      fetchStudents(page);
      refreshExpand();
    } else toast?.error(res.data.msg);
  };

  const quickStatus = async (id, s) => {
    if (!canEditStudent) return;
    let payload = { status: s };
    if (s === '无效') {
      const reason = window.prompt(
        '请简要说明无效原因\n例如：空号 / 明确拒绝 / 已报他校 / 家长态度恶劣',
      );
      if (!reason || !reason.trim()) {
        // 用户取消或留空，不提交；重新拉一次列表把下拉值还原
        fetchStudents(page);
        return;
      }
      payload.invalid_reason = reason.trim();
    }
    await api.put(`/students/${id}`, payload);
    fetchStudents(page);
    refreshExpand();
  };
  const quickStage = async (id, s) => {
    if (!canEditStudent) return;
    await api.put(`/students/${id}/stage`, { stage: s });
    fetchStudents(page);
    refreshExpand();
  };
  const quickIntent = async (id, v) => {
    if (!canEditStudent) return;
    await api.put(`/students/${id}`, { intent_level: v });
    fetchStudents(page);
    refreshExpand();
  };

  const handleDelete = async (id) => {
    if (!canDeleteStudent) return;
    try {
      await api.delete(`/students/${id}`);
      if (expandedId === id) setExpandedId(null);
      fetchStudents(page);
    } catch (e) {
      toast?.error('删除失败: ' + (e.response?.data?.msg || e.message));
    }
  };

  const requestDelete = async (student) => {
    const ok = await confirm({
      title: '确认删除学生',
      message:
        `将删除「${student.name || `学生 ${student.id}`}」。\n` +
        '会同时删除该学生的通话、备注、回访、到访和查看记录。\n' +
        '此操作不可恢复，需具备删除学生操作权限。',
      confirmText: '确认删除',
      tone: 'danger',
    });
    if (!ok) return;
    handleDelete(student.id);
  };

  const requestInvalidateEnrolled = async (student) => {
    if (!canInvalidateEnrolled || student.status !== '已报名') return;
    const ok = await confirm({
      title: '确认取消报名',
      message:
        `将「${student.name || `学生 ${student.id}`}」的状态从“已报名”改为“无效”。\n` +
        '学生档案、历史记录和原话务员归属会保留；无效原因记为“其他”。',
      confirmText: '取消报名并转无效',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.post(`/students/${student.id}/invalidate-enrollment`);
      toast?.success('已取消报名并转为无效');
      if (expandedId === student.id) setExpandedId(null);
      fetchStudents(page);
    } catch (e) {
      toast?.error('取消报名失败: ' + getApiErrorMessage(e));
    }
  };

  const addNote = async (id) => {
    const txt = noteText[id] || '';
    if (!txt.trim()) return;
    await api.post('/notes', { student_id: id, content: txt });
    setNoteText((prev) => ({ ...prev, [id]: '' }));
    refreshExpand();
  };

  const addFollowUp = async (id) => {
    const date = followUpDate[id];
    if (!date) return;
    await api.post('/follow-ups', { student_id: id, follow_up_date: date + ':00' });
    setFollowUpDate((prev) => ({ ...prev, [id]: '' }));
  };

  const createHomeVisitTask = async (student) => {
    if (!canManageHomeVisits) return;
    setHomeSubmittingId(student.id);
    try {
      await api.post('/admissions/home-visits', {
        student_id: student.id,
        intent_program: student.program || '',
        exam_score: student.score ?? null,
        address: '',
        priority: '中',
        notes: '管理员从学生管理页生成家访任务',
      });
      toast?.success('已生成家访任务');
      fetchStudents(page);
      refreshExpand();
      navigate('/admin/home-visits');
    } catch (e) {
      toast?.error('生成家访任务失败: ' + getApiErrorMessage(e));
    } finally {
      setHomeSubmittingId(null);
    }
  };

  const createCampusVisitTask = async (student) => {
    if (!canManageCampusVisits) return;
    setCampusSubmittingId(student.id);
    try {
      await api.post('/admissions/campus-visits', {
        student_id: student.id,
        source: '管理员补录',
        intent_program: student.program || '',
        visitor_count: 1,
        notes: '管理员从学生管理页生成到校任务',
      });
      toast?.success('已生成到校任务');
      fetchStudents(page);
      refreshExpand();
      api.get('/stats/stages').then((r) => setStageStats(r.data.data || {})).catch((e) => logger.error('加载阶段统计失败:', e));
      navigate('/admin/campus-visits');
    } catch (e) {
      toast?.error('生成到校任务失败: ' + getApiErrorMessage(e));
    } finally {
      setCampusSubmittingId(null);
    }
  };

  const handleAssignAgent = async (id, agentId) => {
    if (!canAssignStudents) return;
    if (!agentId) return;
    await api.post('/students/assign', { student_ids: [id], agent_id: parseInt(agentId) });
    fetchStudents(page);
    refreshExpand();
  };

  const handleSubstageChange = async (id, value) => {
    if (!canEditStudent) return;
    try {
      await api.put(`/students/${id}/enrollment-substage`, {
        enrollment_substage: value === '' ? null : value,
      });
      refreshExpand();
      fetchStudents(page);
    } catch (e) {
      toast?.error('更新报名后状态失败: ' + getApiErrorMessage(e));
    }
  };

  const openEnrollmentConfirm = (student) => {
    if (!canCreateEnrollment || student.status === '已报名' || student.stage === '已报名') return;
    setEnrollmentStudent(student);
    setEnrollmentForm({
      enrolled_program: student.program || '',
      amount: student.deposit ?? '',
      tuition_list_amount: '',
      student_subsidy_amount: '',
      student_paid_amount: '',
      external_subsidy_amount: '',
      commission_base_amount: '',
      commission_subsidy_amount: '',
      enrolled_at: student.enrolled_at || '',
    });
  };

  const closeEnrollmentConfirm = () => {
    if (enrollmentSubmitting) return;
    setEnrollmentStudent(null);
  };

  const handleEnroll = async () => {
    if (!enrollmentStudent || enrollmentSubmitting) return;
    if (!enrollmentStudent.assigned_to) {
      toast?.error('该学生尚未分配坐席，请先分配后再登记报名');
      return;
    }
    const payload = {
      student_id: enrollmentStudent.id,
      source: '管理员补录',
      enrolled_program: enrollmentForm.enrolled_program.trim(),
    };
    if (enrollmentForm.amount !== '' && enrollmentForm.amount != null) {
      payload.amount = Number(enrollmentForm.amount);
    }
    [
      'tuition_list_amount',
      'student_subsidy_amount',
      'student_paid_amount',
      'external_subsidy_amount',
      'commission_base_amount',
      'commission_subsidy_amount',
    ].forEach((field) => {
      if (enrollmentForm[field] !== '' && enrollmentForm[field] != null) {
        payload[field] = Number(enrollmentForm[field]);
      }
    });
    if (enrollmentForm.enrolled_at) {
      payload.enrolled_at = `${enrollmentForm.enrolled_at}T00:00:00`;
    }
    setEnrollmentSubmitting(true);
    try {
      const response = await api.post('/admissions/enrollments', payload);
      if (response.data.code !== 0) {
        toast?.error(response.data.msg || '报名登记失败');
        return;
      }
      toast?.success('已登记报名并生成结算依据');
      setEnrollmentStudent(null);
      fetchStudents(page);
      refreshExpand();
    } catch (e) {
      toast?.error('报名登记失败: ' + getApiErrorMessage(e));
    } finally {
      setEnrollmentSubmitting(false);
    }
  };

  const toggleNeedHelp = async (id) => {
    await api.post(`/students/${id}/need-help`);
    fetchStudents(page);
    refreshExpand();
  };

  const handleEditSave = async () => {
    if (!canEditStudent) return;
    if (!editStudent) return;
    const { id, name, region, score, guardian_name, guardian_phone, guardian2_name, guardian2_phone, school_name } = editStudent;
    await api.put(`/students/${id}`, { name, region, score, guardian_name, guardian_phone, guardian2_name, guardian2_phone, school_name });
    setShowEdit(false);
    setEditStudent(null);
    fetchStudents(page);
    refreshExpand();
  };

  const openEditStudent = async (s) => {
    if (!canEditStudent) return;
    try {
      const res = await api.get(`/students/${s.id}/phone-plain`);
      const phoneData = res.data?.data || {};
      setEditStudent({
        id: s.id,
        name: s.name,
        region: s.region || '',
        score: s.score || '',
        guardian_name: s.guardian_name || '',
        guardian_phone: phoneData.guardian_phone || '',
        guardian2_name: s.guardian2_name || '',
        guardian2_phone: phoneData.guardian2_phone || '',
        school_name: s.school_name || '',
      });
      setShowEdit(true);
    } catch (e) {
      toast?.error('加载明文电话失败: ' + getApiErrorMessage(e));
    }
  };

  const handleDialStudent = async (studentId, contactKey = 'guardian') => {
    if (!canViewStudentPhone) return;
    try {
      const res = await api.get(`/students/phone/${studentId}`);
      if (res.data.code !== 0) {
        toast?.error(res.data.msg || '获取电话失败');
        return;
      }
      const phone =
        contactKey === 'guardian2'
          ? res.data.data?.guardian2_phone || ''
          : res.data.data?.guardian_phone || '';
      if (!phone) {
        toast?.error('该联系人没有电话');
        return;
      }
      window.location.href = `tel:${phone}`;
    } catch (e) {
      toast?.error(getApiErrorMessage(e) || '获取电话失败');
    }
  };

  const closeSidebar = () => setSidebarOpen(false);

  // ── Expand panel wiring ──
  const expandPermissions = {
    canViewStudentPhone,
    canEditStudent,
    canAssignStudents,
    canCreateEnrollment,
    canInvalidateEnrolled,
    canDeleteStudent,
    canManageHomeVisits,
    canManageCampusVisits,
  };

  const expandActions = {
    reload: loadExpandData,
    dial: handleDialStudent,
    quickStage,
    quickStatus,
    quickIntent,
    addNote,
    addFollowUp,
    onNoteChange: (id, value) => setNoteText((prev) => ({ ...prev, [id]: value })),
    onFollowUpChange: (id, value) => setFollowUpDate((prev) => ({ ...prev, [id]: value })),
    assignAgent: handleAssignAgent,
    toggleNeedHelp,
    openEdit: openEditStudent,
    openEnrollment: openEnrollmentConfirm,
    invalidateEnrolled: requestInvalidateEnrolled,
    remove: requestDelete,
    changeSubstage: handleSubstageChange,
    createHomeVisit: createHomeVisitTask,
    createCampusVisit: createCampusVisitTask,
  };

  // ── Row rendering ──
  // ── Desktop row wiring ──
  const rowPermissions = {
    canEditStudent,
    canDeleteStudent,
  };

  const rowActions = {
    toggleExpand,
    toggleSelect: toggleSel,
    quickStage,
    quickStatus,
    remove: requestDelete,
  };

  // ── Mobile card wiring ──
  const mobilePermissions = {
    canEditStudent,
    canDeleteStudent,
    canManageHomeVisits,
    canManageCampusVisits,
  };

  const mobileActions = {
    toggleSelect: toggleSel,
    toggleExpand,
    quickStatus,
    quickStage,
    addNote,
    onNoteChange: (id, value) => setNoteText((prev) => ({ ...prev, [id]: value })),
    toggleNeedHelp,
    remove: requestDelete,
    openEdit: openEditStudent,
    createHomeVisit: createHomeVisitTask,
    createCampusVisit: createCampusVisitTask,
  };

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar} compactSidebar={!isMobile}>
      <main className={adminPageMainClass}>
        <PageHeader
          title="学生管理"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          actionsClassName="flex max-w-[72vw] items-center gap-1.5 overflow-x-auto scrollbar-none"
        >
            {canAssignStudents && selected.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAssignOverrideReason('');
                  setShowAssign(true);
                }}
                className="flex min-h-10 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white"
                aria-label={`分配已选 ${selected.size} 个学生`}
                title="分配已选学生"
              >
                <UserPlus className="w-4 h-4" />
                {!isMobile && '分配(' + selected.size + ')'}
              </button>
            )}
            {canCreateStudent && (
              <button
                type="button"
                onClick={() => {
                  setShowCreate(true);
                  setCreateErr('');
                }}
                className={`flex min-h-10 items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${selected.size > 0 ? 'border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200' : 'bg-blue-600 text-white'}`}
                aria-label="新建学生"
                title="新建学生"
              >
                <Plus className="w-4 h-4" />
                {!isMobile && '新建'}
              </button>
            )}
            {canImportStudents && (
              <button
                type="button"
                onClick={() => {
                  setShowImport(true);
                  setImportResult(null);
                  setImportFile(null);
                }}
                className="flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                aria-label="导入学生"
                title="导入学生"
              >
                <FileUp className="w-4 h-4" />
                {!isMobile && '导入'}
              </button>
            )}
            {canAssignStudents && (
              <button
                type="button"
                onClick={handleRegionAssign}
                className="flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                aria-label="按学校分发"
                title="按学校分发"
              >
                <MapPin className="w-4 h-4" />
                {!isMobile && '学校分发'}
              </button>
            )}
            {canAssignStudents && (
              <button
                type="button"
                onClick={handleAutoAssign}
                disabled={autoAssigning}
                className="flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                aria-label="自动均摊分配"
                title="自动均摊分配"
              >
                {autoAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {!isMobile && '自动均摊'}
              </button>
            )}
            {isMobile && (
              <button
                onClick={toggle}
                className="inline-flex min-w-10 min-h-10 items-center justify-center rounded-lg"
                aria-label={dark ? '亮色模式' : '暗色模式'}
              >
                {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-gray-500" />}
              </button>
            )}
        </PageHeader>

        <AdminPageContainer>
          <AdminPageIntro
            title="线索资产与跟进"
            description="集中完成线索查询、筛选、分配和阶段推进；点击统计卡片可直接进入对应线索范围。"
            meta={<><span className="font-semibold text-slate-900 dark:text-slate-100">{total}</span> 条线索</>}
          />
          {/* Search */}
          <AdminSurface className="p-3 lg:p-4">
            <form onSubmit={handleSearch} className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <div className="relative w-full xl:w-[26rem] xl:max-w-[32rem]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="搜姓名 / 电话 / 学校"
                    aria-label="搜索学生"
                    className={`pl-9 ${inputCls}`}
                  />
                </div>
                <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                  <select
                    aria-label="按分配状态筛选学生"
                    value={assignmentFilter}
                    onChange={(e) => setAssignmentFilter(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">全部归属</option>
                    <option value="unassigned">未分配</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={`agent:${agent.id}`}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="按跟进阶段筛选学生"
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">全部阶段</option>
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {stageLabel(s)}
                      </option>
                    ))}
                  </select>
                  <select aria-label="按状态筛选学生" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                    {STATUS_OPTS.map((s) => (
                      <option key={s} value={s}>
                        {s ? statusLabel(s) : '全部状态'}
                      </option>
                    ))}
                  </select>
                  <select aria-label="按结果或原因筛选学生" value={statusDetail} onChange={(e) => setStatusDetail(e.target.value)} className={inputCls}>
                    {STATUS_DETAIL_OPTS.map((s) => (
                      <option key={s} value={s}>
                        {s || '全部结果/原因'}
                      </option>
                    ))}
                  </select>
                  <select aria-label="按意向等级筛选学生" value={intent} onChange={(e) => setIntent(e.target.value)} className={inputCls}>
                    {INTENT_OPTS.map((l) => (
                      <option key={l} value={l}>
                        {l ? `${l}级意向` : '全部意向'}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setNeedHelp(!needHelp)}
                    className={`inline-flex min-h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium ${
                      needHelp
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    <AlertTriangle className="w-4 h-4" />
                    需协助
                  </button>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="submit" className="min-h-10 min-w-20 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm">
                    搜索
                  </button>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="min-h-10 min-w-20 px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    重置
                  </button>
                </div>
              </div>
              {activeFilterChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
                  {activeFilterChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => clearSingleFilter(chip.key)}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-200"
                    >
                      <span className="truncate">{chip.label}</span>
                      <X className="h-3 w-3 shrink-0" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    清空筛选
                  </button>
                </div>
              )}
            </form>
          </AdminSurface>

          {/* Lead and stage stats */}
          {showGlobalStageStats && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  {
                    key: 'unassigned',
                    label: '未分配线索',
                    value: unassignedLeadCount,
                    hint: '还在公共池，等待分配',
                    className: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800',
                    onClick: () => navigate('/admin/leads?assignment=unassigned'),
                  },
                  {
                    key: 'new',
                    label: '已分配新线索',
                    value: assignedNewLeadCount,
                    hint: '已进入坐席名下，尚处新线索阶段',
                    className: 'border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/30',
                    onClick: () => navigate('/admin/leads?stage=初次联系'),
                  },
                  {
                    key: 'progress',
                    label: '跟进中',
                    value: inProgressLeadCount,
                    hint: '已推进到意向、家访或到校流程',
                    className: 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30',
                  },
                  {
                    key: 'enrolled',
                    label: '已报名',
                    value: enrolledLeadCount,
                    hint: '已完成报名状态的线索',
                    className: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30',
                    onClick: () => navigate('/admin/leads?stage=已报名'),
                  },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={item.onClick}
                    disabled={!item.onClick}
                    className={`rounded-panel border p-3 text-left transition ${item.className} ${item.onClick ? 'hover:-translate-y-0.5 hover:shadow-sm' : 'cursor-default'}`}
                  >
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{item.label}</div>
                    <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{item.value}</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.hint}</div>
                  </button>
                ))}
              </div>

              <div className="bg-gray-50 dark:bg-gray-800 rounded-panel border border-gray-200 dark:border-gray-700 p-4">
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-3 font-medium">跟进阶段分布</div>
                <div className="flex gap-1.5 h-16 items-end">
                  {STAGE_STAT_KEYS.map((s) => {
                    const cnt = stageStats[s] || 0;
                    const maxVal = Math.max(...STAGE_STAT_KEYS.map((key) => stageStats[key] || 0), 1);
                    const pct = cnt > 0 ? Math.max(8, Math.round((cnt / maxVal) * 100)) : 0;
                    return (
                      <div
                        key={s}
                        role="button"
                        tabIndex={0}
                        aria-label={`${stageLabel(s)} ${cnt}人`}
                        className="flex-1 text-center flex flex-col items-center justify-end h-full cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => {
                          if (stage === s) {
                            setStage('');
                            navigate('/admin/leads');
                          } else {
                            setStage(s);
                            navigate(`/admin/leads?stage=${encodeURIComponent(s)}`);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.currentTarget.click();
                          }
                        }}
                      >
                        <div className="text-xs font-bold mb-1 text-gray-700 dark:text-gray-200">{cnt}</div>
                        <div
                          className={`w-full rounded-t transition-all ${stage === s ? 'bg-orange-500' : 'bg-blue-600'}`}
                          style={{ height: `${pct}%` }}
                        />
                        <div className={`text-xs mt-1 truncate ${stage === s ? 'text-orange-600 font-bold dark:text-orange-400' : 'text-gray-600 dark:text-gray-400'}`}>{stageLabel(s)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Student list */}
          <AdminSurface className="overflow-hidden">
            {isMobile ? (
              <div className="bg-gray-50 p-3 dark:bg-gray-900">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-white px-3 text-gray-600 shadow-sm dark:bg-gray-800 dark:text-gray-300"
                  >
                    {selected.size === students.length && students.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                    当前页全选
                  </button>
                  <span className="text-xs text-gray-500">共 {total} 条</span>
                </div>
                {loading ? (
                  <div className="py-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
                  </div>
                ) : students.length === 0 ? (
                  <div className="py-12 text-center text-sm text-gray-400">暂无数据</div>
                ) : (
                  <div className="space-y-3">
                    {students.map((l) => (
                      <LeadsMobileCard
                        key={l.id}
                        lead={l}
                        isExpanded={expandedId === l.id}
                        isSelected={selected.has(l.id)}
                        permissions={mobilePermissions}
                        noteValue={noteText[l.id]}
                        homeSubmitting={homeSubmittingId}
                        campusSubmitting={campusSubmittingId}
                        actions={mobileActions}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-left text-gray-600 dark:text-gray-400">
                      <th className="px-0.5 py-3 w-5"></th>
                      <th className="px-1 py-3 w-12">
                        <button
                          type="button"
                          onClick={toggleAll}
                          className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          aria-label={
                            selected.size === students.length && students.length > 0
                              ? '取消选择当前页全部学生'
                              : '选择当前页全部学生'
                          }
                        >
                          {selected.size === students.length && students.length > 0 ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className="px-2 py-3 font-medium">姓名</th>
                      <th className="px-2 py-3 font-medium hidden md:table-cell">学校</th>
                      <th className="px-2 py-3 font-medium hidden lg:table-cell">阶段</th>
                      <th className="px-2 py-3 font-medium">状态</th>
                      <th className="px-2 py-3 font-medium hidden sm:table-cell">意向</th>
                      <th className="px-2 py-3 font-medium hidden md:table-cell">下一步</th>
                      <th className="px-1 py-3 font-medium w-4"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="text-center py-12">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                        </td>
                      </tr>
                    ) : students.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-center py-12 text-gray-400">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      students.map((l) => (
                        <LeadsTableRow
                          key={l.id}
                          lead={l}
                          isExpanded={expandedId === l.id}
                          isSelected={selected.has(l.id)}
                          permissions={rowPermissions}
                          actions={rowActions}
                        >
                          {expandedId === l.id && (
                            <LeadsExpandPanel
                              studentId={l.id}
                              cache={expandCache[l.id]}
                              permissions={expandPermissions}
                              agents={agents}
                              noteValue={noteText[l.id]}
                              followUpValue={followUpDate[l.id]}
                              homeSubmitting={homeSubmittingId}
                              campusSubmitting={campusSubmittingId}
                              actions={expandActions}
                            />
                          )}
                        </LeadsTableRow>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-3 border-t dark:border-gray-700 flex items-center justify-between text-sm">
              <span className="text-gray-500">
                共 {total} 条{selected.size > 0 ? '，已选 ' + selected.size : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  aria-label="上一页"
                  onClick={() => {
                    const p = page - 1;
                    setPage(p);
                    fetchStudents(p);
                  }}
                  className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span>
                  {page}/{totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  aria-label="下一页"
                  onClick={() => {
                    const p = page + 1;
                    setPage(p);
                    fetchStudents(p);
                  }}
                  className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </AdminSurface>
        </AdminPageContainer>
      </main>

      {/* ── Modals ── */}


      {showImport && (
        <LeadsImportModal
          file={importFile}
          result={importResult}
          importing={importing}
          onClose={() => { setShowImport(false); setImportResult(null); }}
          onFileChange={setImportFile}
          onImport={handleImport}
        />
      )}

      {showCreate && (
        <LeadsCreateModal
          form={newStudent}
          agents={agents}
          error={createErr}
          onClose={() => setShowCreate(false)}
          onFieldChange={(key, value) => setNewStudent((prev) => ({ ...prev, [key]: value }))}
          onSubmit={handleCreate}
        />
      )}

      {showAssign && (
        <LeadsAssignModal
          selectedCount={selected.size}
          selectedStudents={selectedStudents}
          selectedEnrolledStudents={selectedEnrolledStudents}
          agents={agents}
          agentId={assignAgentId}
          selectedAgentName={selectedAgent?.name}
          overrideReason={assignOverrideReason}
          canOverrideCapacity={Boolean(user?.is_super_admin)}
          onClose={() => setShowAssign(false)}
          onAgentChange={setAssignAgentId}
          onReasonChange={setAssignOverrideReason}
          onSubmit={handleAssign}
        />
      )}

      {showEdit && editStudent && (
        <LeadsEditModal
          student={editStudent}
          onClose={() => { setShowEdit(false); setEditStudent(null); }}
          onChange={(key, value) => setEditStudent((prev) => ({ ...prev, [key]: value }))}
          onSave={handleEditSave}
        />
      )}

      {enrollmentStudent && (
        <LeadsEnrollmentModal
          student={enrollmentStudent}
          form={enrollmentForm}
          submitting={enrollmentSubmitting}
          onClose={closeEnrollmentConfirm}
          onFieldChange={(field, value) => setEnrollmentForm((prev) => ({ ...prev, [field]: value }))}
          onSubmit={handleEnroll}
        />
      )}

      {showSchoolAssign && (
        <LeadsSchoolAssignModal
          loading={schoolAssignLoading}
          listLoading={schoolListLoading}
          dispatchRegions={dispatchRegions}
          selectedRegions={schoolAssignRegions}
          schools={schools}
          school={schoolAssignSchool}
          agents={agents}
          selectedAgents={schoolAssignAgents}
          onClose={() => setShowSchoolAssign(false)}
          onToggleRegion={(name, checked) => setSchoolAssignRegions(
            checked ? [...schoolAssignRegions, name] : schoolAssignRegions.filter((n) => n !== name),
          )}
          onSchoolChange={setSchoolAssignSchool}
          onToggleAgent={(id, checked) => setSchoolAssignAgents(
            checked ? [...schoolAssignAgents, id] : schoolAssignAgents.filter((x) => x !== id),
          )}
          onSubmit={handleSchoolAssign}
        />
      )}

    </AdminLayout>
  );
}
