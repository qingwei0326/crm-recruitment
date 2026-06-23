import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api';
import { buildStudentPayload, getApiErrorMessage } from '../utils';
import { STAGES } from '../labels';

const STATUS_OPTS = ['', '新线索', '非常有意向', '意向了解加微', '未接', '高分段', '无意向', '孩子不想读', '已报名'];
const INTENT_OPTS = ['', '无', 'A', 'B', 'C'];
const STAGE_STAT_KEYS = ['未分配', ...STAGES];
const ENROLLMENT_SUBSTAGES = ['定金待缴', '全款待缴', '已缴全款', '入学注册', '流失'];
const PAGE_SIZE = 15;

const emptyStudentForm = {
  name: '', region: '', score: '', guardian_name: '', guardian_phone: '',
  guardian2_name: '', guardian2_phone: '', school_name: '', school_address: '',
  status: '', intent_level: '', stage: '', join_reasons: '', program: '',
  deposit: '', enrolled_at: '', assigned_to: '', need_help: false,
};

export default function useLeadsManage({ toast, confirm }) {
  const [searchParams] = useSearchParams();
  const [autoAssigning, setAutoAssigning] = useState(false);

  // List state
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
  const [selected, setSelected] = useState(new Set());

  // Modal flags
  const [showImport, setShowImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showSchoolAssign, setShowSchoolAssign] = useState(false);

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

  // Fetch students
  const fetchStudents = useCallback(
    (p) => {
      setLoading(true);
      const params = { page: p || page, page_size: PAGE_SIZE };
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
        .catch(() => { toast?.error('数据加载失败'); })
        .finally(() => setLoading(false));
    },
    [page, q, status, region, stage, assignment, needHelp, toast],
  );

  useEffect(() => {
    fetchStudents(1);
    setPage(1);
  }, [status, region, stage, assignment, needHelp]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/admin/agents').then((r) => setAgents(r.data.data || [])).catch(() => {});
    api.get('/stats/stages').then((r) => setStageStats(r.data.data || {})).catch(() => {});
  }, []);

  // Load expand data
  const loadExpandData = useCallback(async (id) => {
    if (expandCache[id]) return;
    try {
      const [notesRes, callsRes] = await Promise.allSettled([
        api.get(`/notes?student_id=${id}`),
        api.get(`/calls?student_id=${id}&page_size=3`),
      ]);
      setExpandCache((prev) => ({
        ...prev,
        [id]: {
          notes: notesRes.status === 'fulfilled' ? notesRes.value.data.data || [] : [],
          calls: callsRes.status === 'fulfilled' ? callsRes.value.data.data?.list || [] : [],
        },
      }));
    } catch { /* ignore */ }
  }, [expandCache]);

  // Handle import
  const handleImport = useCallback(async () => {
    if (!importFile) return;
    setImporting(true);
    const form = new FormData();
    form.append('file', importFile);
    try {
      const res = await api.post('/students/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResult(res.data);
      fetchStudents(1);
    } catch (e) {
      setImportResult({ code: 1, msg: getApiErrorMessage(e) });
    } finally {
      setImporting(false);
    }
  }, [importFile, fetchStudents]);

  // Handle create
  const handleCreate = useCallback(async () => {
    if (!newStudent.name) { setCreateErr('姓名必填'); return; }
    try {
      const res = await api.post('/students', buildStudentPayload(newStudent));
      if (res.data.code === 0) {
        setShowCreate(false);
        setNewStudent(emptyStudentForm);
        setCreateErr('');
        fetchStudents(1);
        toast?.success('学生已创建');
      } else {
        setCreateErr(res.data.msg || '创建失败');
      }
    } catch (e) {
      setCreateErr(getApiErrorMessage(e));
    }
  }, [newStudent, fetchStudents, toast]);

  // Handle assign
  const handleAssign = useCallback(async () => {
    if (!assignAgentId || selected.size === 0) return;
    try {
      await api.post('/students/assign', {
        student_ids: [...selected],
        agent_id: Number(assignAgentId),
      });
      setShowAssign(false);
      setSelected(new Set());
      fetchStudents(page);
      toast?.success('分配成功');
    } catch (e) {
      toast?.error('分配失败: ' + getApiErrorMessage(e));
    }
  }, [assignAgentId, selected, page, fetchStudents, toast]);

  // Handle auto assign
  const handleAutoAssign = useCallback(async () => {
    if (autoAssigning) return;
    setAutoAssigning(true);
    try {
      const res = await api.post('/students/auto-assign');
      toast?.success(res.data.msg || '自动均摊完成');
      fetchStudents(1);
    } catch (e) {
      toast?.error('自动均摊失败: ' + getApiErrorMessage(e));
    } finally {
      setAutoAssigning(false);
    }
  }, [autoAssigning, fetchStudents, toast]);

  // Quick actions
  const quickStatus = useCallback(async (id, newStatus) => {
    try {
      await api.put(`/students/${id}`, { status: newStatus });
      setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, status: newStatus } : s)));
    } catch (e) { toast?.error('更新失败: ' + getApiErrorMessage(e)); }
  }, [toast]);

  const quickStage = useCallback(async (id, newStage) => {
    try {
      await api.put(`/students/${id}/stage`, { stage: newStage });
      setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, stage: newStage } : s)));
    } catch (e) { toast?.error('更新失败: ' + getApiErrorMessage(e)); }
  }, [toast]);

  const quickIntent = useCallback(async (id, level) => {
    try {
      await api.put(`/students/${id}`, { intent_level: level });
      setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, intent_level: level } : s)));
    } catch (e) { toast?.error('更新失败: ' + getApiErrorMessage(e)); }
  }, [toast]);

  // Delete
  const handleDelete = useCallback(async (id) => {
    try {
      await api.delete(`/students/${id}`);
      setDeleteConfirm(null);
      fetchStudents(page);
      toast?.success('已删除');
    } catch (e) { toast?.error('删除失败: ' + getApiErrorMessage(e)); }
  }, [page, fetchStudents, toast]);

  // Add note
  const addNote = useCallback(async (studentId) => {
    const text = noteText[studentId];
    if (!text?.trim()) return;
    try {
      await api.post('/notes', { student_id: studentId, content: text });
      setNoteText((prev) => ({ ...prev, [studentId]: '' }));
      setExpandCache((prev) => ({ ...prev, [studentId]: undefined }));
      loadExpandData(studentId);
      toast?.success('已记录');
    } catch (e) { toast?.error('添加备注失败: ' + getApiErrorMessage(e)); }
  }, [noteText, loadExpandData, toast]);

  // Add follow up
  const addFollowUp = useCallback(async (studentId) => {
    const date = followUpDate[studentId];
    if (!date) return;
    try {
      await api.post('/follow-ups', { student_id: studentId, follow_up_date: date + ':00' });
      setFollowUpDate((prev) => ({ ...prev, [studentId]: '' }));
      toast?.success('回访已设置');
    } catch (e) { toast?.error('设置失败: ' + getApiErrorMessage(e)); }
  }, [followUpDate, toast]);

  // Update field
  const updateField = useCallback(async (id, field, value) => {
    try {
      await api.put(`/students/${id}`, { [field]: value });
      setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
    } catch (e) { toast?.error('更新失败: ' + getApiErrorMessage(e)); }
  }, [toast]);

  // Toggle select
  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === students.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(students.map((s) => s.id)));
    }
  }, [selected.size, students]);

  return {
    // State
    students, total, page, q, status, region, stage, assignment, needHelp,
    loading, selected, autoAssigning,
    showImport, showCreate, showAssign, showEdit, showSchoolAssign,
    expandedId, expandCache,
    agents, stageStats,
    importFile, importResult, importing,
    newStudent, createErr,
    assignAgentId,
    schools, dispatchRegions, schoolAssignRegions, schoolAssignSchool,
    schoolAssignAgents, schoolAssignLoading, schoolListLoading,
    noteText, followUpDate,
    editStudent, deleteConfirm,
    // Constants
    PAGE_SIZE, STATUS_OPTS, INTENT_OPTS, STAGE_STAT_KEYS, ENROLLMENT_SUBSTAGES, emptyStudentForm,
    // Setters
    setPage, setQ, setStatus, setRegion, setStage, setNeedHelp,
    setShowImport, setShowCreate, setShowAssign, setShowEdit, setShowSchoolAssign,
    setExpandedId, setImportFile, setImportResult, setImporting,
    setNewStudent, setCreateErr, setAssignAgentId,
    setSchools, setDispatchRegions, setSchoolAssignRegions, setSchoolAssignSchool,
    setSchoolAssignAgents, setSchoolAssignLoading, setSchoolListLoading,
    setNoteText, setFollowUpDate, setEditStudent, setDeleteConfirm,
    setSelected, setAutoAssigning,
    // Actions
    fetchStudents, loadExpandData, handleImport, handleCreate,
    handleAssign, handleAutoAssign, quickStatus, quickStage, quickIntent,
    handleDelete, addNote, addFollowUp, updateField,
    toggleSelect, toggleSelectAll,
  };
}
