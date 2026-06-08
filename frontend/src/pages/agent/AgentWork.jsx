import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import {
  X,
  AlertTriangle,
} from 'lucide-react';
import HelpModal from '../../components/HelpModal';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { getApiErrorMessage, buildStudentPayload } from '../../utils';
import {
  emptyStudentForm,
} from './agentWorkUtils';

// Extracted components
import AgentWorkDesktop from './AgentWorkDesktop';
import AgentWorkMobile from './AgentWorkMobile';
import StudentCreateModal from './StudentCreateModal';
import SettingsModal from './desktop/SettingsModal';
import DialResultModal from './desktop/DialResultModal';

export default function AgentWork() {
  const { user, logout } = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const toast = useToast();

  // ── State ──
  const [students, setStudents] = useState([]);
  const [stats, setStats] = useState({ total: 0, done: 0, pending: 0, follow_up: 0, progress_pct: 0 });
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [selectedStage, setSelectedStage] = useState(null);
  const [selectedIntent, setSelectedIntent] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'days', direction: 'desc' });
  const [expandedId, setExpandedId] = useState(null);
  const [viewTab, setViewTab] = useState('today');
  const [showMenu, setShowMenu] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenMsg, setTokenMsg] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newStudent, setNewStudent] = useState(emptyStudentForm);
  const [createErr, setCreateErr] = useState('');
  const [detailStudent, setDetailStudent] = useState(null);
  const [detailNotes, setDetailNotes] = useState([]);
  const [noteIdx, setNoteIdx] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailNotesError, setDetailNotesError] = useState('');
  const [noteText, setNoteText] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [visitType, setVisitType] = useState('来校参观');
  const [visitDate, setVisitDate] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [followingData, setFollowingData] = useState(null);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [lockedStudentId, setLockedStudentId] = useState(null);
  const [dialModal, setDialModal] = useState(null);
  const [backlogAlert, setBacklogAlert] = useState(null);
  const [activeStudent, setActiveStudent] = useState(null);
  const [showAi, setShowAi] = useState(false);
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [dialCheckByStudent, setDialCheckByStudent] = useState({});
  const [schoolGroups, setSchoolGroups] = useState([]);
  const [scoreRange, setScoreRange] = useState({ min: '', max: '' });

  // ── Effects ──
  useEffect(() => {
    const raw = sessionStorage.getItem('pendingDial');
    if (raw) {
      try {
        const data = JSON.parse(raw);
        sessionStorage.removeItem('pendingDial');
        setDialModal(data);
      } catch { sessionStorage.removeItem('pendingDial'); }
    }
  }, []);

  useEffect(() => {
    api.get('/tasks/today').then((res) => {
      if (res.data.code === 0) {
        setStudents(res.data.data.list || []);
        setStats(res.data.data.stats || {});
        setSchoolGroups(res.data.data.schools || []);
      }
    }).catch(() => { toast?.error('数据加载失败'); });
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `crm_backlog_dismissed_${user.id}_${today}`;
    if (localStorage.getItem(key)) return;
    api.get('/tasks/backlog', { params: { days_threshold: 3 } }).then((r) => {
      if (r.data.code === 0 && r.data.data?.count > 0) setBacklogAlert(r.data.data);
    }).catch(() => {});
  }, [user?.id]);

  // Prediction + dial check for current student
  useEffect(() => {
    const c = filteredStudents[currentIdx];
    if (c) {
      api.get(`/stats/predict-conversion/${c.id}`).then((r) => {
        if (r.data.code === 0) setPrediction(r.data.data);
      }).catch(() => setPrediction(null));
      api.get('/calls/check', { params: { student_id: c.id, within_hours: 24 } }).then((r) => {
        if (r.data.code === 0) setDialCheckByStudent((prev) => ({ ...prev, [c.id]: r.data.data }));
      }).catch(() => {});
    }
  }, [students, currentIdx]);

  useEffect(() => { setCurrentIdx(0); }, [selectedSchool, selectedStage, selectedIntent, scoreRange]);

  // ── Derived data ──
  const filteredStudents = useMemo(() => {
    let result = students;
    if (selectedSchool) result = result.filter((s) => (s.school_name || '未知学校') === selectedSchool);
    if (selectedStage) result = result.filter((s) => s.stage === selectedStage);
    if (selectedIntent) result = result.filter((s) => s.intent_level === selectedIntent);
    if (scoreRange.min !== '' || scoreRange.max !== '') {
      result = result.filter((s) => {
        const sc = s.score;
        if (sc == null || sc === '') return false;
        const n = Number(sc);
        if (scoreRange.min !== '' && n < Number(scoreRange.min)) return false;
        if (scoreRange.max !== '' && n > Number(scoreRange.max)) return false;
        return true;
      });
    }
    return result;
  }, [students, selectedSchool, selectedStage, selectedIntent, scoreRange]);

  const filteredStats = useMemo(() => {
    const hasScoreFilter = scoreRange.min !== '' || scoreRange.max !== '';
    if (!selectedSchool && !selectedStage && !selectedIntent && !hasScoreFilter) return stats;
    const list = filteredStudents;
    const total = list.length;
    const done = list.filter((s) => s.status === 'contacted').length;
    const pending = list.filter((s) => s.status === 'not_contacted').length;
    const follow_up = list.filter((s) => s.status === 'pending_visit').length;
    const handled = done + follow_up;
    return { total, done, pending, follow_up, progress_pct: total > 0 ? Math.round((handled / total) * 1000) / 10 : 0 };
  }, [selectedSchool, selectedStage, selectedIntent, scoreRange, stats, filteredStudents]);

  const current = filteredStudents[currentIdx];

  // ── Handlers ──
  const fetchToday = () => {
    api.get('/tasks/today').then((res) => {
      if (res.data.code === 0) {
        setStudents(res.data.data.list || []);
        setStats(res.data.data.stats || {});
        setSchoolGroups(res.data.data.schools || []);
        setCurrentIdx((idx) => Math.min(idx, Math.max((res.data.data.list || []).length - 1, 0)));
      }
    }).catch(() => { toast?.error('加载今日任务失败'); });
  };

  const fetchFollowing = () => {
    setFollowingLoading(true);
    api.get('/tasks/following').then((r) => setFollowingData(r.data.data))
      .catch(() => { toast?.error('加载跟进中数据失败'); }).finally(() => setFollowingLoading(false));
  };

  const flashMsg = (m) => { setActionMsg(m); setTimeout(() => setActionMsg(''), 2000); };

  const handleCreate = async () => {
    if (!newStudent.name) { setCreateErr('姓名和电话必填'); return; }
    try {
      const res = await api.post('/students', buildStudentPayload(newStudent));
      if (res.data.code === 0) {
        setShowCreate(false); setNewStudent(emptyStudentForm); setCreateErr('');
        fetchToday(); flashMsg('学生已添加');
      } else { setCreateErr(res.data.msg || '创建失败'); }
    } catch (e) { setCreateErr(getApiErrorMessage(e)); }
  };

  const updateStatus = async (id, s) => {
    let payload = { status: s };
    if (s === '无效') {
      const reason = window.prompt('请简要说明无效原因\n例如：空号 / 明确拒绝 / 已报他校 / 家长态度恶劣');
      if (!reason || !reason.trim()) return;
      payload.invalid_reason = reason.trim();
    }
    await api.put(`/students/${id}`, payload);
    setStudents((p) => p.map((t) => (t.id === id ? { ...t, status: s } : t)));
    if (detailStudent?.id === id) setDetailStudent((p) => (p ? { ...p, status: s } : null));
    setLockedStudentId((prev) => (prev === id ? null : prev));
    flashMsg('状态已更新');
  };

  const handleDialModalStatus = async (s) => {
    if (!dialModal) return;
    await updateStatus(dialModal.studentId, s);
    if (s === '已联系' || s === '待回访') {
      setDialModal((p) => p ? { ...p, showIntent: true } : null);
    } else { setDialModal(null); next(); }
  };

  const handleDialModalIntent = async (level) => {
    if (!dialModal) return;
    await updateDetailField('intent_level', level);
    flashMsg('意向等级已更新');
    setDialModal(null); next();
  };

  const updateStage = async (id, stag) => {
    await api.put(`/students/${id}/stage`, { stage: stag });
    setStudents((p) => p.map((t) => t.id === id ? { ...t, stage: stag, status: stag === '已报名' ? '已报名' : t.status } : t));
    flashMsg('阶段已更新');
  };

  const addNote = async (targetId) => {
    const id = targetId || current?.id;
    if (!noteText.trim() || !id) return;
    await api.post('/notes', { student_id: id, content: noteText });
    setNoteText(''); flashMsg('已记录');
    loadDetail(id);
  };

  const addFollowUp = async () => {
    if (!followUpDate || !current) return;
    await api.post('/follow-ups', { student_id: current.id, follow_up_date: followUpDate + ':00' });
    setFollowUpDate(''); flashMsg('回访提醒已设置');
  };

  const addVisit = async () => {
    if (!visitDate || !current) return;
    await api.post('/visits', { student_id: current.id, visit_type: visitType, scheduled_date: visitDate + ':00', notes: visitNotes });
    setVisitDate(''); setVisitNotes(''); flashMsg('到访已记录');
  };

  const toggleNeedHelp = async () => {
    if (!current) return;
    const res = await api.post(`/students/${current.id}/need-help`);
    setStudents((p) => p.map((t) => (t.id === current.id ? { ...t, need_help: res.data.data.need_help } : t)));
    flashMsg(res.data.data.need_help ? '已标记需要协助' : '已取消协助标记');
  };

  const refreshDialCheck = async (id) => {
    try {
      const r = await api.get('/calls/check', { params: { student_id: id, within_hours: 24 } });
      if (r.data.code === 0) { setDialCheckByStudent((prev) => ({ ...prev, [id]: r.data.data })); return r.data.data; }
    } catch {} return null;
  };

  const handleDial = async (contactKey, id) => {
    const check = await refreshDialCheck(id);
    const count = check?.count ?? 0;
    if (count >= 3) {
      const ok = await confirm({ title: '拨号频次提醒', message: `该学生 24h 内已被拨打 ${count} 次（来自任意坐席），确认继续？`, confirmText: '仍要拨打', tone: 'danger' });
      if (!ok) return;
    }
    let phone = '';
    try {
      const r = await api.get(`/students/phone/${id}`);
      if (r.data.code === 0) phone = contactKey === 'guardian2' ? r.data.data.guardian2_phone || '' : r.data.data.guardian_phone || '';
    } catch (err) {
      if (err?.response?.status === 403) { toast?.error(err.response.data?.detail || '当前不允许拨号'); return; }
      toast?.error(err?.response?.data?.detail || '获取电话失败'); return;
    }
    if (!phone) { toast?.error('该联系人没有电话'); return; }
    const dialStudent = students.find((s) => s.id === id);
    sessionStorage.setItem('pendingDial', JSON.stringify({ studentId: id, studentName: dialStudent?.name || '未知' }));
    window.location.href = `tel:${phone}`;
    setLockedStudentId(id);
    refreshDialCheck(id);
  };

  const loadDetail = async (id) => {
    const fallbackStudent = students.find((s) => s.id === id);
    if (fallbackStudent) setDetailStudent((prev) => (prev?.id === id ? prev : fallbackStudent));
    setShowDetail(true); setShowAi(false);
    setDetailLoading(true); setDetailError(''); setDetailNotesError('');
    try {
      const [studentResult, notesResult, callsResult] = await Promise.allSettled([
        api.get(`/students/${id}`), api.get(`/notes?student_id=${id}`), api.get(`/calls?student_id=${id}&page_size=5`),
      ]);
      if (studentResult.status === 'fulfilled') setDetailStudent(studentResult.value.data.data);
      else setDetailError(getApiErrorMessage(studentResult.reason));
      if (notesResult.status === 'fulfilled') setDetailNotes(notesResult.value.data.data || []);
      else { setDetailNotes([]); setDetailNotesError(getApiErrorMessage(notesResult.reason)); }
      setNoteIdx(0);
      if (callsResult.status === 'fulfilled') setHasAnalysis(callsResult.value.data.data?.list?.some((c) => c.analyzed_at));
      else setHasAnalysis(false);
    } finally { setDetailLoading(false); }
  };

  const updateDetailField = async (field, value) => {
    if (!detailStudent) return;
    await api.put(`/students/${detailStudent.id}`, { [field]: value });
    setDetailStudent((p) => (p ? { ...p, [field]: value } : null));
    setStudents((prev) => prev.map((t) => (t.id === detailStudent.id ? { ...t, [field]: value } : t)));
  };

  const openAiPanel = (s) => { setActiveStudent(s); setShowDetail(false); setShowAi(true); };

  const updateScore = async (id, score) => {
    await api.put(`/students/${id}`, { score });
    setStudents((p) => p.map((t) => (t.id === id ? { ...t, score } : t)));
    flashMsg('成绩已更新');
  };
  const prev = () => { if (currentIdx > 0) setCurrentIdx(currentIdx - 1); };
  const next = () => { if (currentIdx < filteredStudents.length - 1) setCurrentIdx(currentIdx + 1); };

  const dismissBacklogAlert = () => {
    if (user?.id) { const today = new Date().toISOString().slice(0, 10); localStorage.setItem(`crm_backlog_dismissed_${user.id}_${today}`, '1'); }
    setBacklogAlert(null);
  };

  const backlogBanner = backlogAlert ? (
    <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-700 px-4 py-2.5 flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0" />
      <div className="flex-1 text-sm text-amber-800 dark:text-amber-200">
        你有 <span className="font-bold">{backlogAlert.count}</span> 个学员积压超过{' '}
        {backlogAlert.threshold_days} 天没动
        {backlogAlert.oldest_days > 0 && `，最久 ${backlogAlert.oldest_days} 天`}
      </div>
      <button onClick={() => { setViewTab('following'); fetchFollowing(); dismissBacklogAlert(); }}
        className="text-xs text-amber-700 dark:text-amber-200 font-medium whitespace-nowrap">去看看</button>
      <button onClick={dismissBacklogAlert} className="text-amber-600 dark:text-amber-300 hover:text-amber-800 shrink-0" aria-label="关闭提醒">
        <X className="w-4 h-4" />
      </button>
    </div>
  ) : null;

  // ── Modals ──
  const modals = (
    <>
      {showCreate && (
        <StudentCreateModal student={newStudent} setStudent={setNewStudent} error={createErr}
          onClose={() => setShowCreate(false)} onSubmit={handleCreate} />
      )}
      <SettingsModal show={showSettings} onClose={() => setShowSettings(false)}
        tokenInput={tokenInput} setTokenInput={setTokenInput}
        tokenSaving={tokenSaving} setTokenSaving={setTokenSaving}
        tokenMsg={tokenMsg} setTokenMsg={setTokenMsg} />
      <DialResultModal dialModal={dialModal}
        onStatusSelect={handleDialModalStatus} onIntentSelect={handleDialModalIntent}
        onClose={() => setDialModal(null)} />
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </>
  );

  // ═══════════════════════════════════════════════
  // MOBILE LAYOUT — delegates to AgentWorkMobile
  // ═══════════════════════════════════════════════
  if (isMobile) {
    return (
      <AgentWorkMobile
        viewTab={viewTab} setViewTab={setViewTab}
        students={students} filteredStudents={filteredStudents} filteredStats={filteredStats}
        schoolGroups={schoolGroups} selectedSchool={selectedSchool} setSelectedSchool={setSelectedSchool}
        currentIdx={currentIdx} setCurrentIdx={setCurrentIdx} current={current}
        prediction={prediction} lockedStudentId={lockedStudentId}
        showMenu={showMenu} setShowMenu={setShowMenu}
        showCreate={showCreate} setShowCreate={setShowCreate} createErr={createErr} setCreateErr={setCreateErr}
        showDetail={showDetail} setShowDetail={setShowDetail}
        detailStudent={detailStudent} detailLoading={detailLoading} detailError={detailError}
        detailNotes={detailNotes} detailNotesError={detailNotesError} noteIdx={noteIdx} setNoteIdx={setNoteIdx}
        hasAnalysis={hasAnalysis}
        showAi={showAi} setShowAi={setShowAi} activeStudent={activeStudent}
        noteText={noteText} setNoteText={setNoteText}
        actionMsg={actionMsg}
        dialCheckByStudent={dialCheckByStudent}
        toggleTheme={toggleTheme} dark={dark}
        handleDial={handleDial} updateStatus={updateStatus} updateStage={updateStage}
        addNote={addNote} openAiPanel={openAiPanel} updateScore={updateScore}
        loadDetail={loadDetail} updateDetailField={updateDetailField}
        prev={prev} next={next}
        toggleNeedHelp={toggleNeedHelp}
        fetchFollowing={fetchFollowing}
        followingData={followingData} followingLoading={followingLoading}
        modals={modals}
        backlogBanner={backlogBanner}
      />
    );
  }

  // ═══════════════════════════════════════════════
  // DESKTOP LAYOUT — delegates to AgentWorkDesktop
  // ═══════════════════════════════════════════════
  return (
    <>
      <AgentWorkDesktop
        user={user} dark={dark} toggleTheme={toggleTheme} logout={logout}
        viewTab={viewTab} setViewTab={setViewTab}
        students={students} filteredStudents={filteredStudents} filteredStats={filteredStats}
        schoolGroups={schoolGroups}
        currentIdx={currentIdx} setCurrentIdx={setCurrentIdx} current={current}
        expandedId={expandedId} setExpandedId={setExpandedId}
        sortConfig={sortConfig} setSortConfig={setSortConfig}
        selectedSchool={selectedSchool} setSelectedSchool={setSelectedSchool}
        selectedStage={selectedStage} setSelectedStage={setSelectedStage}
        selectedIntent={selectedIntent} setSelectedIntent={setSelectedIntent}
        scoreRange={scoreRange} setScoreRange={setScoreRange}
        backlogAlert={backlogAlert} dismissBacklogAlert={dismissBacklogAlert} backlogBanner={backlogBanner}
        fetchFollowing={fetchFollowing} followingData={followingData} followingLoading={followingLoading}
        onHelpOpen={() => setHelpOpen(true)}
        onAddStudent={() => { setShowCreate(true); setCreateErr(''); }}
        onShowSettings={() => setShowSettings(true)}
        noteText={noteText} setNoteText={setNoteText}
        dialCheckByStudent={dialCheckByStudent} lockedStudentId={lockedStudentId}
        handleDial={handleDial} updateStatus={updateStatus} updateStage={updateStage}
        addNote={addNote} openAiPanel={openAiPanel}
        showDetail={showDetail} detailStudent={detailStudent}
        showAi={showAi} activeStudent={activeStudent}
        setShowDetail={setShowDetail} setShowAi={setShowAi}
        loadDetail={loadDetail}
      />
      {modals}
    </>
  );
}
