import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import { stageLabel, statusLabel } from '../../labels';
import { formatDateTime } from '../../utils';
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
  Users,
  Plus,
  Clock,
  Loader2,
  Calendar,
  Sun,
  Moon,
  MapPin,
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Trash2,
  Download,
  ChevronDown,
  Edit3,
  ExternalLink,
} from 'lucide-react';

const STATUS_OPTS = ['', '未联系', '已联系', '待回访', '已完成', '无效', '已报名', '拒绝接听', '已过期'];
const INTENT_OPTS = ['', '无', 'A', 'B', 'C'];
const STAGES = ['初次联系', '有意向', '已送资料', '预约参观', '已来访', '已报名'];
const STAGE_STAT_KEYS = ['未分配', ...STAGES];
const ENROLLMENT_SUBSTAGES = ['定金待缴', '全款待缴', '已缴全款', '入学注册', '流失'];
const inputCls =
  'w-full px-3 py-2.5 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400';
const emptyStudentForm = {
  name: '',
  region: '',
  score: '',
  guardian_name: '',
  guardian_phone: '',
  guardian2_name: '',
  guardian2_phone: '',
  school_name: '',
  school_address: '',
  status: '',
  intent_level: '',
  stage: '',
  join_reasons: '',
  program: '',
  deposit: '',
  enrolled_at: '',
  assigned_to: '',
  need_help: false,
};
const createStudentFields = [
  { key: 'name', label: '姓名', required: true },
  { key: 'region', label: '地域' },
  { key: 'score', label: '成绩', type: 'number' },
  { key: 'guardian_name', label: '监护人姓名' },
  { key: 'guardian_phone', label: '监护人电话' },
  { key: 'guardian2_name', label: '监护人2姓名' },
  { key: 'guardian2_phone', label: '监护人2电话' },
  { key: 'school_name', label: '学校名称' },
  { key: 'join_reasons', label: '报名原因/备注', type: 'textarea' },
  { key: 'program', label: '报名专业' },
  { key: 'deposit', label: '定金', type: 'number' },
  { key: 'enrolled_at', label: '报名日期', type: 'date' },
];

function buildStudentPayload(form) {
  const payload = {
    name: form.name.trim(),
  };
  [
    'region',
    'guardian_name',
    'guardian_phone',
    'guardian2_name',
    'guardian2_phone',
    'school_name',
    'join_reasons',
    'program',
  ].forEach((key) => {
    const value = form[key]?.trim();
    if (value) payload[key] = value;
  });
  ['status', 'intent_level', 'stage', 'enrolled_at'].forEach((key) => {
    if (form[key]) payload[key] = form[key];
  });
  ['score', 'deposit'].forEach((key) => {
    if (form[key] !== '' && form[key] != null) payload[key] = Number(form[key]);
  });
  if (form.assigned_to) payload.assigned_to = Number(form.assigned_to);
  if (form.need_help) payload.need_help = true;
  return payload;
}

function maskPhone(p) {
  if (!p || p.length < 7) return p;
  return p.slice(0, 3) + '****' + p.slice(-4);
}

function getApiErrorMessage(error) {
  return error?.response?.data?.detail || error?.response?.data?.msg || error?.message || '加载失败';
}

function schoolPlaceholder(regions, loading, schools) {
  if (regions.length === 0) return '请先选择区县';
  if (loading) return '加载学校中...';
  if (schools.length === 0) return '所选区县下无未分配学生';
  return '-- 请选择 --';
}

export default function LeadsManage() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [students, setStudents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [region, setRegion] = useState(searchParams.get('region') || '');
  const [stage, setStage] = useState(searchParams.get('stage') || '');
  const assignment = searchParams.get('assignment') || '';
  const [needHelp, setNeedHelp] = useState(searchParams.get('need_help') === '1');
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

  // Edit modal
  const [editStudent, setEditStudent] = useState(null);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchStudents = useCallback(
    (p) => {
      setLoading(true);
      const params = { page: p || page, page_size: pageSize };
      if (q) params.q = q;
      if (status) params.status = status;
      if (region) params.region = region;
      if (stage) params.stage = stage;
      if (assignment) params.assignment = assignment;
      if (needHelp) params.need_help = '1';
      api
        .get('/students', { params })
        .then((res) => {
          setStudents(res.data.data?.list || []);
          setTotal(res.data.data?.total || 0);
          setSelected(new Set());
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    },
    [page, q, status, region, stage, assignment, needHelp],
  );

  useEffect(() => {
    fetchStudents(1);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, region, stage, assignment, needHelp]);

  useEffect(() => {
    api.get('/admin/agents').then((r) => setAgents(r.data.data || [])).catch(() => {});
    api.get('/stats/stages').then((r) => setStageStats(r.data.data || {})).catch(() => {});
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
          alert('学校列表加载失败: ' + getApiErrorMessage(e));
        }
      })
      .finally(() => {
        if (reqId === schoolsReqIdRef.current) setSchoolListLoading(false);
      });
  }, [showSchoolAssign, schoolAssignRegions]);

  const loadExpandData = async (id) => {
    setExpandCache((prev) => {
      const current = prev[id];
      if (current && !current.error) return prev;
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
    if (expandedId) loadExpandData(expandedId);
  };

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
    if (selected.size === 0 || !assignAgentId) return;
    await api.post('/students/assign', { student_ids: [...selected], agent_id: parseInt(assignAgentId) });
    setShowAssign(false);
    fetchStudents(page);
    refreshExpand();
  };

  const handleRegionAssign = async () => {
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
      alert('区县列表加载失败: ' + getApiErrorMessage(e));
    } finally {
      setSchoolAssignLoading(false);
    }
  };

  const handleSchoolAssign = async () => {
    if (schoolAssignRegions.length === 0) return alert('请先选择区县');
    if (!schoolAssignSchool) return alert('请选择学校');
    if (schoolAssignAgents.length === 0) return alert('请选择至少一个话务员');
    const res = await api.post('/students/school-assign', {
      school_name: schoolAssignSchool,
      regions: schoolAssignRegions,
      agent_ids: schoolAssignAgents,
    });
    if (res.data.code === 0) {
      alert(`分发完成：${res.data.data.total_assigned} 名学生`);
      setShowSchoolAssign(false);
      fetchStudents(page);
      refreshExpand();
    } else alert(res.data.msg);
  };

  const quickStatus = async (id, s) => {
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
    await api.put(`/students/${id}/stage`, { stage: s });
    fetchStudents(page);
    refreshExpand();
  };
  const quickIntent = async (id, v) => {
    await api.put(`/students/${id}`, { intent_level: v });
    fetchStudents(page);
    refreshExpand();
  };

  const handleExtend = async (id) => {
    await api.put(`/students/${id}/extend?days=15`);
    fetchStudents(page);
    refreshExpand();
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/students/${id}`);
      setDeleteConfirm(null);
      if (expandedId === id) setExpandedId(null);
      fetchStudents(page);
    } catch (e) {
      alert('删除失败: ' + (e.response?.data?.msg || e.message));
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

  const updateField = async (id, field, value) => {
    await api.put(`/students/${id}`, { [field]: value });
    fetchStudents(page);
    refreshExpand();
  };

  const handleAssignAgent = async (id, agentId) => {
    if (!agentId) return;
    await api.post('/students/assign', { student_ids: [id], agent_id: parseInt(agentId) });
    fetchStudents(page);
    refreshExpand();
  };

  const handleSubstageChange = async (id, value) => {
    try {
      await api.put(`/students/${id}/enrollment-substage`, {
        enrollment_substage: value === '' ? null : value,
      });
      refreshExpand();
      fetchStudents(page);
    } catch (e) {
      alert('更新报名后状态失败: ' + getApiErrorMessage(e));
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
    if (!editStudent) return;
    const { id, name, region, score, guardian_name, guardian_phone, guardian2_name, guardian2_phone, school_name, school_address } = editStudent;
    await api.put(`/students/${id}`, { name, region, score, guardian_name, guardian_phone, guardian2_name, guardian2_phone, school_name, school_address });
    setShowEdit(false);
    setEditStudent(null);
    fetchStudents(page);
    refreshExpand();
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
                  ['成绩', s.score != null ? s.score : '-', false],
                  ['监护人', s.guardian_name || '-', false],
                  ['监护人电话', s.guardian_phone_raw || s.guardian_phone || '-', true],
                  ['监护人2', s.guardian2_name || '-', false],
                  ['监护人2电话', s.guardian2_phone_raw || s.guardian2_phone || '-', true],
                  ['学校', s.school_name || '-', false],
                ].map(([k, v, isPhone]) => (
                  <div key={k} className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border dark:border-gray-700">
                    <div className="text-xs text-gray-400">{k}</div>
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {isPhone && v && v !== '-' ? (
                        <a
                          href={`tel:${v}`}
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {v}
                        </a>
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
                        title={st}
                        className={`flex-1 h-2 rounded-full transition-colors ${
                          i <= curIdx ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'
                        } ${st === s.stage ? 'ring-2 ring-blue-300' : ''}`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  {STAGES.map((st) => (
                    <span key={st} className="truncate max-w-[16%] text-center">
                      {(() => { const lab = stageLabel(st); return lab.length > 2 ? lab.slice(0, 2) : lab; })()}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t dark:border-gray-600 pt-3">
                {/* Status */}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">状态</label>
                  <select
                    value={s.status}
                    onChange={(e) => quickStatus(s.id, e.target.value)}
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
                    value={s.intent_level}
                    onChange={(e) => quickIntent(s.id, e.target.value)}
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
              {user?.role === 'admin' && (
                <div className="border-t dark:border-gray-600 pt-3">
                  <label className="text-xs text-gray-500 mb-1 block">分配话务员</label>
                  <select
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
                <button
                  onClick={() => {
                    setEditStudent({
                      id: s.id,
                      name: s.name,
                      region: s.region || '',
                      score: s.score || '',
                      guardian_name: s.guardian_name || '',
                      guardian_phone: s.guardian_phone_raw || s.guardian_phone || '',
                      guardian2_name: s.guardian2_name || '',
                      guardian2_phone: s.guardian2_phone_raw || s.guardian2_phone || '',
                      school_name: s.school_name || '',
                    });
                    setShowEdit(true);
                  }}
                  className="flex items-center gap-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  编辑信息
                </button>

                {s.status === '已过期' && (
                  <button
                    onClick={() => handleExtend(s.id)}
                    className="px-3 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 rounded-lg text-xs"
                  >
                    延期+15天
                  </button>
                )}

                {user?.role === 'admin' && (
                  <button
                    onClick={() => setDeleteConfirm(s.id)}
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
                  {user?.role === 'admin' && (
                    <div className="flex items-center gap-2 pt-2 border-t border-green-200 dark:border-green-800">
                      <label className="text-xs text-green-700 dark:text-green-300 font-medium">
                        报名后状态
                      </label>
                      <select
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
          } ${l.status === '已过期' ? 'opacity-60' : ''} ${
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
            <button onClick={() => toggleSel(l.id)}>
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
                className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
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
              value={l.stage}
              onChange={(e) => {
                e.stopPropagation();
                quickStage(l.id, e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 border-0 cursor-pointer"
            >
              {STAGES.map((st) => (
                <option key={st} value={st}>{stageLabel(st)}</option>
              ))}
            </select>
          </td>
          <td className="px-2 py-2.5">
            <select
              value={l.status}
              onChange={(e) => {
                e.stopPropagation();
                quickStatus(l.id, e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
              className={`text-xs px-1.5 py-0.5 rounded-full border-0 cursor-pointer ${
                l.status === '已报名'
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700'
                  : l.status === '未联系'
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-600'
                  : l.status === '已过期'
                  ? 'bg-gray-200 text-gray-400'
                  : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700'
              }`}
            >
              {STATUS_OPTS.filter(Boolean).map((st) => (
                <option key={st} value={st}>{statusLabel(st)}</option>
              ))}
            </select>
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
          <td className="px-1 py-2.5 w-4" />
        </tr>
        {renderExpandContent(l)}
      </Fragment>
    );
  };

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-900">
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
      `}</style>

      {/* ── Mobile sidebar overlay ── */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40" onClick={closeSidebar} />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`${
          isMobile
            ? 'fixed inset-y-0 left-0 z-50 shadow-2xl transform transition-transform ' +
              (sidebarOpen ? 'translate-x-0' : '-translate-x-full')
            : ''
        } w-60 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Phone className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-gray-900 dark:text-gray-100">CRM 管理后台</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{user?.name}</div>
            </div>
          </div>
          {isMobile && (
            <button onClick={closeSidebar}>
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        <nav className="p-3 space-y-1">
          <Link
            to="/admin"
            onClick={closeSidebar}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> 仪表盘
          </Link>
          <Link
            to="/admin/agents"
            onClick={closeSidebar}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
          >
            <Users className="w-4 h-4" /> 话务员管理
          </Link>
          <Link
            to="/admin/report"
            onClick={closeSidebar}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
          >
            <BarChart3 className="w-4 h-4" /> 汇总报表
          </Link>
          <Link
            to="/admin/trend"
            onClick={closeSidebar}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
          >
            <TrendingUp className="w-4 h-4" /> 趋势报表
          </Link>
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
            <Search className="w-4 h-4" /> 学生管理
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
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
          {isMobile && (
            <button
              className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600"
              onClick={(e) => {
                e.stopPropagation();
                setSidebarOpen(true);
              }}
              style={{ touchAction: 'manipulation' }}
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">学生管理</h2>
          </div>
          <div className="flex items-center gap-1.5">
            {selected.size > 0 && (
              <button
                onClick={() => setShowAssign(true)}
                className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium"
              >
                <UserPlus className="w-4 h-4" />
                {!isMobile && '分配(' + selected.size + ')'}
              </button>
            )}
            <button
              onClick={() => {
                setShowCreate(true);
                setCreateErr('');
              }}
              className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm"
            >
              <Plus className="w-4 h-4" />
              {!isMobile && '新建'}
            </button>
            <button
              onClick={() => {
                setShowImport(true);
                setImportResult(null);
                setImportFile(null);
              }}
              className="flex items-center gap-1 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm"
            >
              <FileUp className="w-4 h-4" />
              {!isMobile && '导入'}
            </button>
            <button
              onClick={handleRegionAssign}
              className="flex items-center gap-1 px-3 py-2 bg-teal-600 text-white rounded-lg text-sm"
            >
              <MapPin className="w-4 h-4" />
              {!isMobile && '学校分发'}
            </button>
            <button
              onClick={() => navigate('/admin/leads?assignment=unassigned')}
              className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-sm"
            >
              <Users className="w-4 h-4" />
              {!isMobile && '未分配任务'}
            </button>
            {isMobile && (
              <button onClick={toggle} className="p-2 rounded-lg">
                {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-gray-500" />}
              </button>
            )}
          </div>
        </header>

        <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
          {/* Search */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-3 lg:p-4 shadow-sm">
            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="????/??/??..."
                  className={`pl-9 ${inputCls}`}
                />
              </div>
              <div className="flex gap-2">
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-auto`}>
                  {STATUS_OPTS.map((s) => (
                    <option key={s} value={s}>
                      {s ? statusLabel(s) : '全部状态'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setNeedHelp(!needHelp)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium ${
                    needHelp
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 inline mr-1" />
                  需协助
                </button>
                <button type="submit" className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm">
                  搜索
                </button>
              </div>
            </form>
          </div>

          {/* Stage stats bar */}
          {Object.keys(stageStats).length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-3 font-medium">跟进阶段分布</div>
              <div className="flex gap-1.5 h-16 items-end">
                {STAGE_STAT_KEYS.map((s) => {
                  const cnt = stageStats[s] || 0;
                  const maxVal = Math.max(...Object.values(stageStats), 1);
                  const pct = cnt > 0 ? Math.max(8, Math.round((cnt / maxVal) * 100)) : 0;
                  return (
                    <div
                      key={s}
                      className="flex-1 text-center flex flex-col items-center justify-end h-full cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => {
                        if (s === '未分配') {
                          navigate('/admin/leads?assignment=unassigned');
                          return;
                        }
                        if (stage === s) {
                          setStage('');
                          navigate('/admin/leads');
                        } else {
                          setStage(s);
                          navigate(`/admin/leads?stage=${encodeURIComponent(s)}`);
                        }
                      }}
                    >
                      <div className="text-xs font-bold mb-1 text-gray-700 dark:text-gray-200">{cnt}</div>
                      <div
                        className={`w-full rounded-t transition-all ${stage === s ? 'bg-orange-500' : 'bg-blue-600'}`}
                        style={{ height: `${pct}%` }}
                      />
                      <div className={`text-xs mt-1 truncate ${stage === s ? 'text-orange-600 font-bold dark:text-orange-400' : 'text-gray-600 dark:text-gray-400'}`}>{s === '未分配' ? s : stageLabel(s)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Student table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-left text-gray-600 dark:text-gray-400">
                    <th className="px-0.5 py-3 w-5"></th>
                    <th className="px-1 py-3 w-12">
                      <button onClick={toggleAll}>
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
            <div className="px-4 py-3 border-t dark:border-gray-700 flex items-center justify-between text-sm">
              <span className="text-gray-500">
                共 {total} 条{selected.size > 0 ? '，已选 ' + selected.size : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => {
                    const p = page - 1;
                    setPage(p);
                    fetchStudents(p);
                  }}
                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span>
                  {page}/{totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => {
                    const p = page + 1;
                    setPage(p);
                    fetchStudents(p);
                  }}
                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
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
                Excel需包含列：<b>姓名</b>、<b>电话</b>、成绩、监护人姓名、监护人电话、学校名称、学校地址、地域（可选），仅支持 .xlsx
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
                      value={newStudent[field.key] || ''}
                      onChange={(e) => setNewStudent({ ...newStudent, [field.key]: e.target.value })}
                      className={`${inputCls} h-20 resize-none`}
                      rows={3}
                    />
                  ) : (
                    <input
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
                <select value={newStudent.status} onChange={(e) => setNewStudent({ ...newStudent, status: e.target.value })} className={inputCls}>
                  {STATUS_OPTS.map((o) => <option key={o} value={o}>{o ? statusLabel(o) : '默认'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">意向等级</label>
                <select value={newStudent.intent_level} onChange={(e) => setNewStudent({ ...newStudent, intent_level: e.target.value })} className={inputCls}>
                  {INTENT_OPTS.map((o) => <option key={o} value={o}>{o || '默认'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">跟进阶段</label>
                <select value={newStudent.stage} onChange={(e) => setNewStudent({ ...newStudent, stage: e.target.value })} className={inputCls}>
                  <option value="">默认</option>
                  {STAGES.map((o) => <option key={o} value={o}>{stageLabel(o)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">分配话务员</label>
                <select value={newStudent.assigned_to} onChange={(e) => setNewStudent({ ...newStudent, assigned_to: e.target.value })} className={inputCls}>
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
              <div className="text-sm">已选择 <b>{selected.size}</b> 名学生</div>
              <select value={assignAgentId} onChange={(e) => setAssignAgentId(e.target.value)} className={inputCls}>
                <option value="">选择话务员</option>
                {agents.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
              </select>
              <button onClick={handleAssign} disabled={!assignAgentId} className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm disabled:opacity-50">确认分配</button>
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

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <Trash2 className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-2">确认删除</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">此操作不可恢复，确定要删除该学生吗？</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm">取消</button>
                <button onClick={() => handleDelete(deleteConfirm)} className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm">确认删除</button>
              </div>
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

    </div>
  );
}
