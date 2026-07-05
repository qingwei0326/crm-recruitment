import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import logger from '../../utils/logger';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import PhoneLink from '../../components/PhoneLink';
import { stageLabel, statusLabel, STAGES } from '../../labels';
import { formatDateTime, buildStudentPayload, getApiErrorMessage } from '../../utils';
import {
  CAMPUS_ACTION_STAGES,
  ENROLLMENT_SUBSTAGES,
  HOME_ACTION_STAGES,
  INTENT_OPTS,
  STAGE_STAT_KEYS,
  STATUS_DETAIL_OPTS,
  STATUS_OPTS,
  compactStageLabel,
  createStudentFields,
  emptyStudentForm,
  getAssignedToFromOwnershipFilter,
  getOwnershipFilterFromParams,
  inputCls,
  schoolPlaceholder,
} from './leadsManageUtils';
import {
  ADMIN_PAGE_PERMISSIONS,
  ADMIN_OPERATION_PERMISSIONS,
  canAccessAdminPage,
  canPerformAdminOperation,
} from '../../adminPermissions';
import {
  ArrowLeft,
  Search,
  ChevronLeft,
  ChevronRight,
  Upload,
  Phone,
  LogOut,
  Menu,
  UserPlus,
  FileUp,
  X,
  CheckSquare,
  Square,
  Plus,
  Clock,
  Loader2,
  Calendar,
  Sun,
  Moon,
  Home as HomeIcon,
  MapPin,
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Trash2,
  Download,
  ChevronDown,
  Edit3,
  ExternalLink,
  Wand2,
} from 'lucide-react';


export default function LeadsManage() {
  const { user, logout } = useAuth();
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
  const canImportStudents = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentImport);
  const canAssignStudents = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentAssign);
  const canViewStudentPhone = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentPhone);
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
    [page, q, status, statusDetail, region, stage, intent, assignmentFilter, needHelp, activeOnly, todayAOnly, missingPhoneOnly],
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
  }, [showSchoolAssign, schoolAssignRegions]);

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
    await api.post('/students/assign', { student_ids: [...selected], agent_id: parseInt(assignAgentId) });
    setShowAssign(false);
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
          toast?.success(`已自动分配 ${d.total_assigned} 名：${detail}`);
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
      toast?.success(`分发完成：${res.data.data.total_assigned} 名学生`);
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

  const updateField = async (id, field, value) => {
    if (!canEditStudent) return;
    await api.put(`/students/${id}`, { [field]: value });
    fetchStudents(page);
    refreshExpand();
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

  const handleEnroll = async (id) => {
    const data = expandCache[id]?.student;
    if (!data) return;
    await api.put(`/students/${id}/enroll`, {
      program: data.program || '',
      deposit: data.deposit || null,
      enrolled_at: data.enrolled_at || '',
    });
    refreshExpand();
    fetchStudents(page);
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

  // ── Render helpers ──
  const renderExpandContent = (l) => {
    if (expandedId !== l.id) return null;
    const data = expandCache[l.id];
    if (!data || data.loading) {
      return (
        <tr className="bg-slate-50 dark:bg-gray-800">
          <td colSpan={9} className="px-4 py-8 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          </td>
        </tr>
      );
    }
    if (data.error) {
      return (
        <tr className="bg-slate-50 dark:bg-gray-800">
          <td colSpan={9} className="px-4 py-6">
            <div className="flex items-center justify-center gap-3 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="w-4 h-4" />
              <span>{data.error}</span>
              <button
                onClick={() => loadExpandData(l.id)}
                className="px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50"
              >
                重新加载
              </button>
            </div>
          </td>
        </tr>
      );
    }
    const s = data.student;
    const notes = data.notes || [];

    return (
      <tr className="bg-slate-50 dark:bg-gray-800 expand-row">
        <td colSpan={9} className="px-4 py-4">
          <div className="border-l-4 border-blue-500 pl-3 grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fadeIn">
            {/* ── Left Column: Student Info + Notes ── */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider border-b pb-2 mb-1">
                学生信息 & 联系记录
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['成绩', s.score != null ? s.score : '-', null],
                  ['监护人', s.guardian_name || '-', null],
                  ['监护人电话', s.guardian_phone_raw || s.guardian_phone || '', 'guardian'],
                  ['监护人2', s.guardian2_name || '-', null],
                  ['监护人2电话', s.guardian2_phone_raw || s.guardian2_phone || '', 'guardian2'],
                  ['学校', s.school_name || '-', null],
                ].map(([k, v, contactKey]) => (
                  <div key={k} className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border dark:border-gray-700">
                    <div className="text-xs text-gray-400">{k}</div>
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {contactKey && canViewStudentPhone ? (
                        <PhoneLink
                          value={v}
                          label={`拨打${k}`}
                          onDial={() => handleDialStudent(l.id, contactKey)}
                        />
                      ) : (
                        v
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Last 3 notes */}
              <div>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  最近联系记录
                </div>
                {data.notesError && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg mb-2">
                    联系记录加载失败：{data.notesError}
                  </div>
                )}
                {notes.length === 0 ? (
                  <div className="text-xs text-gray-400 py-2">暂无联系记录</div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {notes.map((n) => (
                      <div key={n.id} className={`rounded-lg px-3 py-2 border ${n.source === 'ai' ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800' : 'bg-white dark:bg-gray-800 dark:border-gray-700'}`}>
                        <div className="flex items-center gap-2 text-xs text-gray-400 mb-0.5">
                          {n.source === 'ai' && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-semibold">AI</span>
                          )}
                          <span className="font-medium text-gray-600 dark:text-gray-300">{n.agent_name}</span>
                          <span>{formatDateTime(n.created_at)}</span>
                        </div>
                        <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {n.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Right Column: Quick Actions ── */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider border-b pb-2 mb-1">
                跟进操作
              </div>

              {/* Stage */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">跟进阶段</label>
                <div className="flex gap-1">
                  {STAGES.map((st, i) => {
                    const curIdx = STAGES.indexOf(s.stage);
                    const active = i <= curIdx && s.stage !== '已报名';
                    return (
                      <button
                        key={st}
                        onClick={() => quickStage(s.id, st)}
                        disabled={!canEditStudent}
                        title={st}
                        className={`flex-1 h-2 rounded-full transition-colors ${
                          i <= curIdx ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'
                        } ${st === s.stage ? 'ring-2 ring-blue-300' : ''} ${
                          canEditStudent ? '' : 'cursor-not-allowed opacity-60'
                        }`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  {STAGES.map((st) => (
                    <span key={st} className="truncate max-w-[16%] text-center">
                      {compactStageLabel(st)}
                    </span>
                  ))}
                </div>
              </div>

              {(canManageHomeVisits || canManageCampusVisits) && (
                <div className="border-t dark:border-gray-600 pt-3">
                  <div className="mb-2">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                      招生任务
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      一键生成任务后进入对应管理页继续安排时间和填写结果。
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canManageHomeVisits && HOME_ACTION_STAGES.has(s.stage) && (
                      <button
                        type="button"
                        onClick={() => createHomeVisitTask(s)}
                        disabled={homeSubmittingId === s.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                      >
                        {homeSubmittingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HomeIcon className="w-3.5 h-3.5" />}
                        生成家访任务
                      </button>
                    )}
                    {canManageCampusVisits && CAMPUS_ACTION_STAGES.has(s.stage) && (
                      <button
                        type="button"
                        onClick={() => createCampusVisitTask(s)}
                        disabled={campusSubmittingId === s.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                      >
                        {campusSubmittingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                        生成到校任务
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 border-t dark:border-gray-600 pt-3">
                {/* Status */}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">状态</label>
                  <select
                    aria-label={`设置 ${s.name || '学生'} 状态`}
                    value={s.status}
                    onChange={(e) => quickStatus(s.id, e.target.value)}
                    disabled={!canEditStudent}
                    className={`${inputCls} text-xs`}
                  >
                    {STATUS_OPTS.filter(Boolean).map((o) => (
                      <option key={o} value={o}>{statusLabel(o)}</option>
                    ))}
                  </select>
                </div>

                {/* Intent */}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">意向等级</label>
                  <select
                    aria-label={`设置 ${s.name || '学生'} 意向等级`}
                    value={s.intent_level}
                    onChange={(e) => quickIntent(s.id, e.target.value)}
                    disabled={!canEditStudent}
                    className={`${inputCls} text-xs`}
                  >
                    {INTENT_OPTS.filter(Boolean).map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Note input */}
              <div className="border-t dark:border-gray-600 pt-3">
                <label className="text-xs text-gray-500 mb-1 block">写备注</label>
                <div className="flex gap-1">
                  <input
                    aria-label={`给 ${s.name || '学生'} 写备注`}
                    value={noteText[s.id] || ''}
                    onChange={(e) => setNoteText((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && addNote(s.id)}
                    placeholder="回车发送…"
                    className={`flex-1 ${inputCls} text-xs`}
                  />
                  <button
                    onClick={() => addNote(s.id)}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs shrink-0"
                  >
                    提交
                  </button>
                </div>
              </div>

              {/* Follow-up date */}
              <div className="border-t dark:border-gray-600 pt-3">
                <label className="text-xs text-gray-500 mb-1 block">设置回访日期</label>
                <div className="flex gap-1">
                  <input
                    aria-label={`设置 ${s.name || '学生'} 回访日期`}
                    type="datetime-local"
                    value={followUpDate[s.id] || ''}
                    onChange={(e) => setFollowUpDate((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    className={`flex-1 ${inputCls} text-xs`}
                  />
                  <button
                    onClick={() => addFollowUp(s.id)}
                    className="px-3 py-2 bg-green-600 text-white rounded-lg text-xs shrink-0"
                  >
                    设置
                  </button>
                </div>
              </div>

              {/* Assign agent (admin only) */}
              {canAssignStudents && (
                <div className="border-t dark:border-gray-600 pt-3">
                  <label className="text-xs text-gray-500 mb-1 block">分配话务员</label>
                  <select
                    aria-label={`分配 ${s.name || '学生'} 给话务员`}
                    value={s.assigned_to || ''}
                    onChange={(e) => handleAssignAgent(s.id, e.target.value)}
                    className={`${inputCls} text-xs`}
                  >
                    <option value="">未分配</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Need help toggle */}
              <div className="flex items-center justify-between border-t dark:border-gray-600 pt-3">
                <span className="text-xs text-gray-500">需要协助</span>
                <button
                  onClick={() => toggleNeedHelp(s.id)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    s.need_help ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                      s.need_help ? 'translate-x-[1.15rem]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-1 border-t dark:border-gray-600 pt-3">
                <Link
                  to={`/admin/leads/${s.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-xs hover:bg-blue-100 dark:hover:bg-blue-900/50"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  查看详情
                </Link>
                {canEditStudent && (
                  <button
                    onClick={() => openEditStudent(s)}
                    className="flex items-center gap-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    编辑信息
                  </button>
                )}

                {canDeleteStudent && (
                  <button
                    onClick={() => requestDelete(s)}
                    className="flex items-center gap-1 px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-xs hover:bg-red-100 dark:hover:bg-red-900/40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除
                  </button>
                )}
              </div>

              {/* Enroll info */}
              {s.status === '已报名' && (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 space-y-2">
                  <div className="text-xs font-semibold text-green-700 dark:text-green-300">报名信息</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>专业: {s.program || '-'}</div>
                    <div>定金: {s.deposit != null ? s.deposit : '-'}</div>
                    <div>报名日: {s.enrolled_at || '-'}</div>
                  </div>
                  {canEditStudent && (
                    <div className="flex items-center gap-2 pt-2 border-t border-green-200 dark:border-green-800">
                      <label className="text-xs text-green-700 dark:text-green-300 font-medium">
                        报名后状态
                      </label>
                      <select
                        aria-label={`设置 ${s.name || '学生'} 报名后状态`}
                        value={s.enrollment_substage || ''}
                        onChange={(e) => handleSubstageChange(s.id, e.target.value)}
                        className={`${inputCls} text-xs flex-1`}
                      >
                        <option value="">(清空)</option>
                        {ENROLLMENT_SUBSTAGES.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  // ── Row rendering ──
  const renderRow = (l) => {
    const isExpanded = expandedId === l.id;
    return (
      <Fragment key={l.id}>
        <tr
          onClick={() => toggleExpand(l.id)}
          className={`cursor-pointer transition-colors ${
            isExpanded
              ? 'bg-blue-50 dark:bg-blue-900/20'
              : 'hover:bg-gray-50 dark:hover:bg-gray-700'
          } ${l.status === '无效' ? 'opacity-60' : ''} ${
            l.need_help ? 'bg-red-50/50 dark:bg-red-900/5' : ''
          }`}
        >
          <td className="pl-1.5 pr-0 py-2.5 text-center">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-blue-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )}
          </td>
          <td className="px-1 py-2.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => toggleSel(l.id)}
              className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label={`${selected.has(l.id) ? '取消选择' : '选择'} ${l.name || '学生'}`}
            >
              {selected.has(l.id) ? (
                <CheckSquare className="w-4 h-4 text-blue-600" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>
          </td>
          <td className="px-2 py-2.5 font-medium">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-900 dark:text-gray-100">{l.name}</span>
              {l.need_help && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
              <Link
                to={`/admin/leads/${l.id}`}
                onClick={(e) => e.stopPropagation()}
                title="查看详情"
                aria-label={`查看 ${l.name || '学生'} 详情`}
                className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </td>
          <td className="px-2 py-2.5 hidden md:table-cell">
            {l.school_name ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-900/30 text-teal-700">
                {l.school_name}
              </span>
            ) : (
              '-'
            )}
          </td>
          <td className="px-2 py-2.5 hidden lg:table-cell">
            <select
              aria-label={`设置 ${l.name || '学生'} 跟进阶段`}
              value={l.stage}
              onChange={(e) => {
                e.stopPropagation();
                quickStage(l.id, e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
              disabled={!canEditStudent}
              className="min-h-9 text-xs px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 border-0 cursor-pointer"
            >
              {STAGES.map((st) => (
                <option key={st} value={st}>{stageLabel(st)}</option>
              ))}
            </select>
          </td>
          <td className="px-2 py-2.5">
            <div className="flex flex-col items-start gap-1">
              <select
                aria-label={`设置 ${l.name || '学生'} 状态`}
              value={l.status}
              onChange={(e) => {
                e.stopPropagation();
                quickStatus(l.id, e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
              disabled={!canEditStudent}
              className={`min-h-9 text-xs px-2 py-1.5 rounded-lg border-0 cursor-pointer ${
                  l.status === '已报名'
                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700'
                    : l.status === '未联系'
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-600'
                    : l.status === '无效'
                    ? 'bg-gray-200 text-gray-400'
                    : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700'
                }`}
              >
                {STATUS_OPTS.filter(Boolean).map((st) => (
                  <option key={st} value={st}>{statusLabel(st)}</option>
                ))}
              </select>
              {l.status_detail && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300">
                  {l.status === '无效' ? `原因：${l.status_detail}` : l.status_detail}
                </span>
              )}
            </div>
          </td>
          <td className="px-2 py-2.5 hidden sm:table-cell">
            {l.intent_level !== '无' ? (
              <span
                className={`inline-block w-6 h-6 rounded-full text-xs font-bold text-center leading-6 ${
                  l.intent_level === 'A'
                    ? 'bg-red-100 text-red-600'
                    : l.intent_level === 'B'
                    ? 'bg-amber-100 text-amber-600'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {l.intent_level}
              </span>
            ) : (
              '-'
            )}
          </td>
          <td className="px-1 py-2.5 w-4">
            {canDeleteStudent && (
              <button
                type="button"
                aria-label={`删除 ${l.name || '学生'}`}
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  requestDelete(l);
                }}
                className="inline-flex min-w-8 min-h-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </td>
        </tr>
        {renderExpandContent(l)}
      </Fragment>
    );
  };

  const renderMobileCard = (l) => {
    const isExpanded = expandedId === l.id;
    return (
      <div
        key={l.id}
        className={`rounded-lg border bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${
          l.need_help ? 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10' : ''
        } ${l.status === '无效' ? 'opacity-75' : ''}`}
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => toggleSel(l.id)}
            className="mt-0.5 inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg bg-gray-50 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
            aria-label={`${selected.has(l.id) ? '取消选择' : '选择'} ${l.name || '学生'}`}
          >
            {selected.has(l.id) ? (
              <CheckSquare className="w-4 h-4 text-blue-600" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => toggleExpand(l.id)}
            className="min-w-0 flex-1 text-left"
            aria-expanded={isExpanded}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
                {l.name || `学生 #${l.id}`}
              </span>
              {l.need_help && <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />}
              {isExpanded ? (
                <ChevronDown className="ml-auto w-4 h-4 shrink-0 text-blue-500" />
              ) : (
                <ChevronRight className="ml-auto w-4 h-4 shrink-0 text-gray-400" />
              )}
            </div>
            <div className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
              {l.school_name || '未知学校'} · {l.region || '未知地区'}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  l.status === '已报名'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : l.status === '无效'
                    ? 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                }`}
              >
                {statusLabel(l.status)}
              </span>
              {l.status_detail && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-gray-700 dark:text-gray-300">
                  {l.status_detail}
                </span>
              )}
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {stageLabel(l.stage)}
              </span>
              {l.intent_level && l.intent_level !== '无' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  {l.intent_level}级
                </span>
              )}
            </div>
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            to={`/admin/leads/${l.id}`}
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-50 px-2 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          >
            详情
          </Link>
          {canEditStudent && (
            <button
              type="button"
              onClick={() => openEditStudent(l)}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-gray-100 px-2 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            >
              编辑
            </button>
          )}
        </div>

        {isExpanded && (
          <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label={`设置 ${l.name || '学生'} 状态`}
                value={l.status}
                onChange={(e) => quickStatus(l.id, e.target.value)}
                disabled={!canEditStudent}
                className={`${inputCls} text-sm`}
              >
                {STATUS_OPTS.filter(Boolean).map((st) => (
                  <option key={st} value={st}>{statusLabel(st)}</option>
                ))}
              </select>
              <select
                aria-label={`设置 ${l.name || '学生'} 跟进阶段`}
                value={l.stage}
                onChange={(e) => quickStage(l.id, e.target.value)}
                disabled={!canEditStudent}
                className={`${inputCls} text-sm`}
              >
                {STAGES.map((st) => (
                  <option key={st} value={st}>{stageLabel(st)}</option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                aria-label={`给 ${l.name || '学生'} 写备注`}
                value={noteText[l.id] || ''}
                onChange={(e) => setNoteText((prev) => ({ ...prev, [l.id]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addNote(l.id)}
                placeholder="写备注..."
                className={`min-w-0 flex-1 ${inputCls}`}
              />
              <button
                type="button"
                onClick={() => addNote(l.id)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-600 px-3 text-sm text-white"
              >
                提交
              </button>
            </div>
            {(canManageHomeVisits || canManageCampusVisits) && (
              <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-900/50 dark:bg-blue-900/10">
                <div className="mb-2">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                    招生任务
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    生成后进入对应管理页继续处理
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {canManageHomeVisits && HOME_ACTION_STAGES.has(l.stage) && (
                    <button
                      type="button"
                      onClick={() => createHomeVisitTask(l)}
                      disabled={homeSubmittingId === l.id}
                      className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {homeSubmittingId === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HomeIcon className="w-3.5 h-3.5" />}
                      生成家访任务
                    </button>
                  )}
                  {canManageCampusVisits && CAMPUS_ACTION_STAGES.has(l.stage) && (
                    <button
                      type="button"
                      onClick={() => createCampusVisitTask(l)}
                      disabled={campusSubmittingId === l.id}
                      className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-green-600 px-3 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {campusSubmittingId === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                      生成到校任务
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => toggleNeedHelp(l.id)}
                className={`rounded-lg px-3 py-2 text-sm ${
                  l.need_help
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }`}
              >
                {l.need_help ? '取消协助' : '需要协助'}
              </button>
              {canDeleteStudent && (
                <button
                  type="button"
                  aria-label={`删除 ${l.name || '学生'}`}
                  onClick={() => requestDelete(l)}
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
                >
                  删除
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      {/* ── Mobile sidebar overlay ── */}
      {/* ── Sidebar ── */}
      {/* ── Main ── */}
      <main className="flex-1 min-w-0">
        <header
          className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 pb-2 flex items-end justify-between"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
            minHeight: 'calc(env(safe-area-inset-top, 0px) + 64px)',
          }}
        >
          <div className="flex min-h-10 items-center gap-3">
          {isMobile && (
            <button
              className="inline-flex min-w-10 min-h-10 -ml-2 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600"
              onClick={(e) => {
                e.stopPropagation();
                setSidebarOpen(true);
              }}
              aria-label="打开导航"
              style={{ touchAction: 'manipulation' }}
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">学生管理</h2>
          </div>
          <div className="flex min-h-10 items-center gap-1.5">
            {canAssignStudents && selected.size > 0 && (
              <button
                type="button"
                onClick={() => setShowAssign(true)}
                className="flex min-h-10 items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium"
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
                className="flex min-h-10 items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm"
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
                className="flex min-h-10 items-center gap-1 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm"
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
                className="flex min-h-10 items-center gap-1 px-3 py-2 bg-teal-600 text-white rounded-lg text-sm"
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
                className="flex min-h-10 items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
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
          </div>
        </header>

        <div className="w-full p-4 lg:p-6 space-y-4">
          {/* Search */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-3 lg:p-4 shadow-sm">
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
          </div>

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
                    className={`rounded-xl border p-3 text-left transition ${item.className} ${item.onClick ? 'hover:-translate-y-0.5 hover:shadow-sm' : 'cursor-default'}`}
                  >
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{item.label}</div>
                    <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{item.value}</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.hint}</div>
                  </button>
                ))}
              </div>

              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
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
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
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
                    {students.map((l) => renderMobileCard(l))}
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
                      <th className="px-1 py-3 font-medium w-4"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="text-center py-12">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                        </td>
                      </tr>
                    ) : students.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-12 text-gray-400">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      students.map((l) => renderRow(l))
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
          </div>
        </div>
      </main>

      {/* ── Modals ── */}


      {/* Import */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowImport(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Excel 批量导入</h3>
              <button onClick={() => { setShowImport(false); setImportResult(null); }}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="text-sm bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded-lg">
                Excel需包含列：<b>姓名</b>、<b>电话</b>、成绩、监护人姓名、监护人电话、学校名称、地域（可选），仅支持 .xlsx
              </div>
              <a href="/api/students/template/download" className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                <Download className="w-3.5 h-3.5" />下载Excel模板
              </a>
              <input type="file" accept=".xlsx" onChange={(e) => setImportFile(e.target.files[0])} className="w-full text-sm" />
              {importFile && <div className="text-sm">已选择: <b>{importFile.name}</b></div>}
              <button
                onClick={handleImport} disabled={!importFile || importing}
                className="w-full py-2.5 bg-purple-600 text-white rounded-lg text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {importing ? (<><Loader2 className="w-4 h-4 animate-spin" />导入中…</>) : (<><Upload className="w-4 h-4" />开始导入</>)}
              </button>
              {importResult && (
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm">
                  <div className="text-green-600">成功: {importResult.success} 条</div>
                  <div className="text-amber-600">跳过: {importResult.skipped} 条</div>
                  {Number(importResult.no_phone || 0) > 0 && (
                    <div className="mt-1 text-red-600">
                      无电话数据: {importResult.no_phone} 条
                    </div>
                  )}
                  {importResult.no_phone_rows?.length > 0 && (
                    <div className="mt-2 max-h-28 overflow-y-auto rounded border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                      {importResult.no_phone_rows.slice(0, 8).map((row) => (
                        <div key={`${row.row}-${row.name || ''}`}>
                          第 {row.row} 行{row.name ? ` · ${row.name}` : ''}: 无电话数据
                        </div>
                      ))}
                      {importResult.no_phone_rows.length > 8 && (
                        <div>还有 {importResult.no_phone_rows.length - 8} 条未显示</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 sticky top-0 bg-white dark:bg-gray-800 z-10 pb-2">
              <h3 className="text-lg font-semibold">新建学生</h3>
              <button onClick={() => setShowCreate(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {createStudentFields.map((field) => (
                <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  <label className="block text-sm mb-1">
                    {field.label} {field.required && '*'}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      aria-label={field.label}
                      value={newStudent[field.key] || ''}
                      onChange={(e) => setNewStudent({ ...newStudent, [field.key]: e.target.value })}
                      className={`${inputCls} h-20 resize-none`}
                      rows={3}
                    />
                  ) : (
                    <input
                      aria-label={field.label}
                      value={newStudent[field.key] || ''}
                      onChange={(e) => setNewStudent({ ...newStudent, [field.key]: e.target.value })}
                      className={inputCls}
                      type={field.type || 'text'}
                    />
                  )}
                </div>
              ))}
              <div>
                <label className="block text-sm mb-1">状态</label>
                <select aria-label="新建学生状态" value={newStudent.status} onChange={(e) => setNewStudent({ ...newStudent, status: e.target.value })} className={inputCls}>
                  {STATUS_OPTS.map((o) => <option key={o} value={o}>{o ? statusLabel(o) : '默认'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">意向等级</label>
                <select aria-label="新建学生意向等级" value={newStudent.intent_level} onChange={(e) => setNewStudent({ ...newStudent, intent_level: e.target.value })} className={inputCls}>
                  {INTENT_OPTS.map((o) => <option key={o} value={o}>{o || '默认'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">跟进阶段</label>
                <select aria-label="新建学生跟进阶段" value={newStudent.stage} onChange={(e) => setNewStudent({ ...newStudent, stage: e.target.value })} className={inputCls}>
                  <option value="">默认</option>
                  {STAGES.map((o) => <option key={o} value={o}>{stageLabel(o)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">分配话务员</label>
                <select aria-label="新建学生分配话务员" value={newStudent.assigned_to} onChange={(e) => setNewStudent({ ...newStudent, assigned_to: e.target.value })} className={inputCls}>
                  <option value="">不分配</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={newStudent.need_help}
                  onChange={(e) => setNewStudent({ ...newStudent, need_help: e.target.checked })}
                  className="rounded border-gray-300"
                />
                标记为需要协助
              </label>
              <div className="sm:col-span-2">
              {createErr && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">{createErr}</div>}
              </div>
              <div className="sm:col-span-2">
              <button onClick={handleCreate} className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm">创建</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAssign(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">批量分配</h3>
              <button onClick={() => setShowAssign(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                已选择 <b>{selected.size}</b> 名学生
                {selectedStudents.length > 0 && (
                  <div className="mt-1 text-xs text-gray-500">
                    将影响：{selectedStudents.slice(0, 3).map((student) => student.name).join('、')}
                    {selectedStudents.length > 3 ? ` 等 ${selectedStudents.length} 人` : ''}
                  </div>
                )}
              </div>
              <select aria-label="选择批量分配话务员" value={assignAgentId} onChange={(e) => setAssignAgentId(e.target.value)} className={inputCls}>
                <option value="">选择话务员</option>
                {agents.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
              </select>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                确认后会把已选学生分配给「{selectedAgent?.name || '未选择'}」，原坐席将不再处理这些线索。
              </div>
              {selectedEnrolledStudents.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                  已选中 {selectedEnrolledStudents.length} 名已报名学生，不能重新分配：
                  {selectedEnrolledStudents.slice(0, 3).map((student) => student.name).join('、')}
                  {selectedEnrolledStudents.length > 3 ? ' 等' : ''}
                </div>
              )}
              <button
                onClick={handleAssign}
                disabled={!assignAgentId || selectedEnrolledStudents.length > 0}
                className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                确认分配
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Student Modal */}
      {showEdit && editStudent && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setShowEdit(false); setEditStudent(null); }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">编辑学生信息</h3>
              <button onClick={() => { setShowEdit(false); setEditStudent(null); }}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              {[
                ['name', '姓名'],
                ['region', '地域'],
                ['score', '成绩'],
                ['guardian_name', '监护人姓名'],
                ['guardian_phone', '监护人电话'],
                ['guardian2_name', '监护人2姓名'],
                ['guardian2_phone', '监护人2电话'],
                ['school_name', '学校名称'],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="block text-sm mb-1">{label}</label>
                  <input
                    aria-label={label}
                    value={editStudent[key] || ''}
                    onChange={(e) => setEditStudent({ ...editStudent, [key]: e.target.value })}
                    className={inputCls}
                    type={key === 'score' ? 'number' : 'text'}
                  />
                </div>
              ))}
              <button onClick={handleEditSave} className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* School Assign Modal */}
      {showSchoolAssign && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowSchoolAssign(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">按学校分发学生</h3>
              <button onClick={() => setShowSchoolAssign(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              {/* Select regions */}
              <div>
                <label className="block text-sm mb-1 font-medium">
                  选择区县（多选）
                  {!schoolAssignLoading && dispatchRegions.length > 0 && (
                    <span className="ml-2 text-xs text-gray-500 font-normal">
                      共 {dispatchRegions.length} 个区县 · {dispatchRegions.reduce((s, r) => s + (r.count || 0), 0)} 人
                    </span>
                  )}
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto border dark:border-gray-600 rounded-lg p-2">
                  {schoolAssignLoading && (
                    <div className="text-sm text-gray-400 px-2 py-1">加载区县中...</div>
                  )}
                  {!schoolAssignLoading && dispatchRegions.length === 0 && (
                    <div className="text-sm text-gray-400 px-2 py-1">暂无可分发的区县</div>
                  )}
                  {!schoolAssignLoading &&
                    dispatchRegions.map((r) => (
                      <label
                        key={r.name}
                        className="flex items-center gap-2 text-sm cursor-pointer px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={schoolAssignRegions.includes(r.name)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSchoolAssignRegions([...schoolAssignRegions, r.name]);
                            } else {
                              setSchoolAssignRegions(
                                schoolAssignRegions.filter((n) => n !== r.name),
                              );
                            }
                          }}
                          className="accent-blue-500"
                        />
                        {r.name} ({r.count}人)
                      </label>
                    ))}
                </div>
                {schoolAssignRegions.length > 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    已选 {schoolAssignRegions.length} 个区县
                  </div>
                )}
              </div>

              {/* Select school */}
              <div>
                <label className="block text-sm mb-1 font-medium">选择学校</label>
                <select
                  aria-label="选择学校"
                  value={schoolAssignSchool}
                  onChange={(e) => setSchoolAssignSchool(e.target.value)}
                  className={inputCls}
                  disabled={schoolAssignRegions.length === 0 || schoolListLoading}
                >
                  <option value="">{schoolPlaceholder(schoolAssignRegions, schoolListLoading, schools)}</option>
                  {!schoolListLoading &&
                    schools.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} ({s.count}人)
                      </option>
                    ))}
                </select>
              </div>

              {/* Select agents */}
              <div>
                <label className="block text-sm mb-1 font-medium">选择话务员（多选）</label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto border dark:border-gray-600 rounded-lg p-2">
                  {agents.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700 rounded">
                      <input
                        type="checkbox"
                        checked={schoolAssignAgents.includes(a.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSchoolAssignAgents([...schoolAssignAgents, a.id]);
                          } else {
                            setSchoolAssignAgents(schoolAssignAgents.filter((id) => id !== a.id));
                          }
                        }}
                        className="accent-blue-500"
                      />
                      {a.name}
                    </label>
                  ))}
                  {agents.length === 0 && (
                    <div className="text-sm text-gray-400 px-2 py-1">暂无可分发的话务员</div>
                  )}
                </div>
                {schoolAssignAgents.length > 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    已选 {schoolAssignAgents.length} 人
                  </div>
                )}
              </div>

              <button
                onClick={handleSchoolAssign}
                disabled={
                  schoolAssignLoading ||
                  schoolListLoading ||
                  schoolAssignRegions.length === 0 ||
                  !schoolAssignSchool ||
                  schoolAssignAgents.length === 0
                }
                className="w-full py-2.5 bg-teal-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                开始分发
              </button>
            </div>
          </div>
        </div>
      )}

    </AdminLayout>
  );
}
