import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import {
  Phone,
  PhoneCall,
  ClipboardPaste,
  Sparkles,
  ChevronUp,
  ChevronDown,
  LogOut,
  Menu,
  X,
  CheckCircle2,
  Clock,
  Loader2,
  ThumbsUp,
  Target,
  MessageSquare,
  BarChart3,
  Calendar,
  CheckCheck,
  UserX,
  History,
  StickyNote,
  Sun,
  Moon,
  MapPin,
  Home,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Plus,
  User,
  BookOpen,
  PhoneCall as PhoneIcon,
  HelpCircle,
} from 'lucide-react';
import HelpModal from '../../components/HelpModal';

const mask = (p) => (p ? p.slice(0, 3) + '****' + p.slice(-4) : '');
const STATUS_STYLE = {
  未联系: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  已联系: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  待回访: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  已完成: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  已报名: 'bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-200',
  无效: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
  拒绝接听: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  已过期: 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
};
const QUICK_STATUSES = [
  { status: '已联系', icon: CheckCheck, color: 'bg-blue-600 hover:bg-blue-700' },
  { status: '待回访', icon: Clock, color: 'bg-amber-600 hover:bg-amber-700' },
  { status: '已报名', icon: CheckCircle2, color: 'bg-green-600 hover:bg-green-700' },
  { status: '无效', icon: UserX, color: 'bg-red-500 hover:bg-red-600' },
];
const STAGES = ['初次联系', '有意向', '已送资料', '预约参观', '已来访', '已报名'];
const inputCls =
  'w-full px-3 py-2.5 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400';
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
  join_reasons: '',
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
  { key: 'school_address', label: '学校地址' },
  { key: 'join_reasons', label: '报名原因/备注', type: 'textarea' },
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
    'school_address',
    'join_reasons',
  ].forEach((key) => {
    const value = form[key]?.trim();
    if (value) payload[key] = value;
  });
  if (form.score !== '' && form.score != null) payload.score = Number(form.score);
  return payload;
}

function getApiErrorMessage(error) {
  return error?.response?.data?.detail || error?.response?.data?.msg || error?.message || '加载失败';
}

export default function AgentWork() {
  const { user, logout } = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const isMobile = useIsMobile();

  const [students, setStudents] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    done: 0,
    pending: 0,
    follow_up: 0,
    progress_pct: 0,
  });
  const [currentIdx, setCurrentIdx] = useState(0);
  const [viewTab, setViewTab] = useState('today');
  const [showMenu, setShowMenu] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newStudent, setNewStudent] = useState(emptyStudentForm);
  const [createErr, setCreateErr] = useState('');

  // Detail & edit
  const [detailStudent, setDetailStudent] = useState(null);
  const [detailNotes, setDetailNotes] = useState([]);
  const [noteIdx, setNoteIdx] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailNotesError, setDetailNotesError] = useState('');

  // Action states
  const [noteText, setNoteText] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [visitType, setVisitType] = useState('来校参观');
  const [visitDate, setVisitDate] = useState('');
  const [visitNotes, setVisitNotes] = useState('');

  // Yesterday
  const [yesterdayData, setYesterdayData] = useState(null);
  const [yesterdayLoading, setYesterdayLoading] = useState(false);

  // Prediction
  const [prediction, setPrediction] = useState(null);

  // Follow-up lock after dial
  const [lockedStudentId, setLockedStudentId] = useState(null);

  // Templates
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // AI
  const [activeStudent, setActiveStudent] = useState(null);
  const [showAi, setShowAi] = useState(false);
  const [hasAnalysis, setHasAnalysis] = useState(false);

  useEffect(() => {
    api
      .get('/tasks/today')
      .then((res) => {
        if (res.data.code === 0) {
          setStudents(res.data.data.list || []);
          setStats(res.data.data.stats || {});
        }
      })
      .catch(console.error);
  }, []);

  const fetchToday = () => {
    api
      .get('/tasks/today')
      .then((res) => {
        if (res.data.code === 0) {
          setStudents(res.data.data.list || []);
          setStats(res.data.data.stats || {});
          setCurrentIdx((idx) => Math.min(idx, Math.max((res.data.data.list || []).length - 1, 0)));
        }
      })
      .catch(console.error);
  };

  useEffect(() => {
    const c = students[currentIdx];
    if (c) {
      api
        .get(`/stats/predict-conversion/${c.id}`)
        .then((r) => {
          if (r.data.code === 0) setPrediction(r.data.data);
        })
        .catch(() => setPrediction(null));
    }
  }, [students, currentIdx]);

  useEffect(() => {
    api
      .get('/templates')
      .then((r) => setTemplates(r.data.data || []))
      .catch(() => {});
  }, []);

  const current = students[currentIdx];

  const handleCreate = async () => {
    if (!newStudent.name) {
      setCreateErr('姓名和电话必填');
      return;
    }
    try {
      const res = await api.post('/students', buildStudentPayload(newStudent));
      if (res.data.code === 0) {
        setShowCreate(false);
        setNewStudent(emptyStudentForm);
        setCreateErr('');
        fetchToday();
        flashMsg('学生已添加');
      } else {
        setCreateErr(res.data.msg || '创建失败');
      }
    } catch (e) {
      setCreateErr(getApiErrorMessage(e));
    }
  };

  const fetchYesterday = () => {
    setYesterdayLoading(true);
    api
      .get('/tasks/yesterday')
      .then((r) => setYesterdayData(r.data.data))
      .catch(console.error)
      .finally(() => setYesterdayLoading(false));
  };

  const updateStatus = async (id, s) => {
    await api.put(`/students/${id}`, { status: s });
    setStudents((p) => p.map((t) => (t.id === id ? { ...t, status: s } : t)));
    if (detailStudent?.id === id) setDetailStudent((p) => (p ? { ...p, status: s } : null));
    setLockedStudentId((prev) => (prev === id ? null : prev));
    flashMsg('状态已更新');
  };

  const updateStage = async (id, stag) => {
    await api.put(`/students/${id}/stage`, { stage: stag });
    setStudents((p) =>
      p.map((t) =>
        t.id === id ? { ...t, stage: stag, status: stag === '已报名' ? '已报名' : t.status } : t,
      ),
    );
    flashMsg('阶段已更新');
  };

  const addNote = async () => {
    if (!noteText.trim() || !current) return;
    await api.post('/notes', { student_id: current.id, content: noteText });
    setNoteText('');
    flashMsg('已记录');
    loadDetail(current.id);
  };

  const addFollowUp = async () => {
    if (!followUpDate || !current) return;
    await api.post('/follow-ups', { student_id: current.id, follow_up_date: followUpDate + ':00' });
    setFollowUpDate('');
    flashMsg('回访提醒已设置');
  };

  const addVisit = async () => {
    if (!visitDate || !current) return;
    await api.post('/visits', {
      student_id: current.id,
      visit_type: visitType,
      scheduled_date: visitDate + ':00',
      notes: visitNotes,
    });
    setVisitDate('');
    setVisitNotes('');
    flashMsg('到访已记录');
  };

  const toggleNeedHelp = async () => {
    if (!current) return;
    const res = await api.post(`/students/${current.id}/need-help`);
    setStudents((p) =>
      p.map((t) => (t.id === current.id ? { ...t, need_help: res.data.data.need_help } : t)),
    );
    flashMsg(res.data.data.need_help ? '已标记需要协助' : '已取消协助标记');
  };

  const flashMsg = (m) => {
    setActionMsg(m);
    setTimeout(() => setActionMsg(''), 2000);
  };

  const checkDup = async (id, phone) => {
    try {
      const r = await api.get('/calls/check', { params: { student_id: id } });
      if (r.data.data?.already_called) return confirm(r.data.data.message);
      return true;
    } catch {
      return true;
    }
  };
  const handleDial = async (phone, id) => {
    const ok = await checkDup(id, phone);
    if (ok) {
      window.location.href = `tel:${phone || ''}`;
      setLockedStudentId(id);
    }
  };

  const loadDetail = async (id) => {
    const fallbackStudent = students.find((s) => s.id === id);
    if (fallbackStudent) setDetailStudent((prev) => (prev?.id === id ? prev : fallbackStudent));
    setShowDetail(true);
    setShowAi(false);
    setDetailLoading(true);
    setDetailError('');
    setDetailNotesError('');
    try {
      const [studentResult, notesResult, callsResult] = await Promise.allSettled([
        api.get(`/students/${id}`),
        api.get(`/notes?student_id=${id}`),
        api.get(`/calls?student_id=${id}&page_size=5`),
      ]);

      if (studentResult.status === 'fulfilled') {
        setDetailStudent(studentResult.value.data.data);
      } else {
        setDetailError(getApiErrorMessage(studentResult.reason));
      }

      if (notesResult.status === 'fulfilled') {
        setDetailNotes(notesResult.value.data.data || []);
      } else {
        setDetailNotes([]);
        setDetailNotesError(getApiErrorMessage(notesResult.reason));
      }

      setNoteIdx(0);

      // Check if any call record has analyzed_at
      if (callsResult.status === 'fulfilled') {
        const calls = callsResult.value.data.data?.list || [];
        setHasAnalysis(calls.some((c) => c.analyzed_at));
      } else {
        setHasAnalysis(false);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const updateDetailField = async (field, value) => {
    if (!detailStudent) return;
    await api.put(`/students/${detailStudent.id}`, { [field]: value });
    setDetailStudent((p) => (p ? { ...p, [field]: value } : null));
    setStudents((prev) =>
      prev.map((t) => (t.id === detailStudent.id ? { ...t, [field]: value } : t)),
    );
  };

  const openAiPanel = (s) => {
    setActiveStudent(s);
    setShowAi(true);
  };

  const prev = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };
  const next = () => {
    if (currentIdx < students.length - 1) setCurrentIdx(currentIdx + 1);
  };

  const Sidebar = () => (
    <>
      <div className="flex items-center justify-between px-4 h-14 border-b dark:border-gray-700">
        <span className="font-semibold text-gray-800 dark:text-gray-100">菜单</span>
        {isMobile && (
          <button
            onClick={() => setShowMenu(false)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        )}
      </div>
      <div className="p-3 space-y-1">
        <button
          onClick={() => {
            setShowMenu(false);
            setViewTab('today');
          }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${viewTab === 'today' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >
          <Target className="w-4 h-4" /> 今日任务
        </button>
        <button
          onClick={() => {
            setShowMenu(false);
            setShowCreate(true);
            setCreateErr('');
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Plus className="w-4 h-4" /> 手动添加学生
        </button>
        <button
          onClick={() => {
            setShowMenu(false);
            setViewTab('yesterday');
            fetchYesterday();
          }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${viewTab === 'yesterday' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >
          <History className="w-4 h-4" /> 昨日回顾
        </button>
      </div>
      <div className="mt-auto p-3 border-t dark:border-gray-700">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
        >
          {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}{' '}
          {dark ? '亮色模式' : '暗色模式'}
        </button>
        <button
          onClick={logout}
          className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
        >
          <LogOut className="w-4 h-4" /> 退出登录
        </button>
      </div>
    </>
  );

  // Mobile layout
  if (isMobile) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <header className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <button onClick={() => setShowMenu(true)} className="p-2 -ml-2">
              <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
            </button>
            <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100">话务工作台</h1>
            {viewTab === 'today' && (
              <span className="text-xs text-gray-500">
                {stats.done}/{stats.total}
              </span>
            )}
          </div>
          <button onClick={toggleTheme} className="p-2 rounded-lg">
            {dark ? (
              <Sun className="w-5 h-5 text-amber-400" />
            ) : (
              <Moon className="w-5 h-5 text-gray-500" />
            )}
          </button>
          <button
            onClick={() => {
              setShowCreate(true);
              setCreateErr('');
            }}
            className="p-2 rounded-lg text-gray-500"
            title="手动添加学生"
          >
            <Plus className="w-5 h-5" />
          </button>
        </header>
        {showMenu && (
          <div className="fixed inset-0 z-30">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowMenu(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-white dark:bg-gray-800 shadow-2xl flex flex-col">
              <Sidebar />
            </div>
          </div>
        )}
        {showCreate && (
          <StudentCreateModal
            student={newStudent}
            setStudent={setNewStudent}
            error={createErr}
            onClose={() => setShowCreate(false)}
            onSubmit={handleCreate}
          />
        )}

        {viewTab === 'today' ? (
          <>
            <div className="grid grid-cols-4 gap-px bg-gray-200 dark:bg-gray-700 shrink-0">
              {[
                { label: '总数', value: stats.total },
                { label: '完成', value: stats.done },
                { label: '待联', value: stats.pending },
                { label: '回访', value: stats.follow_up },
              ].map((s, i) => (
                <div key={i} className="bg-white dark:bg-gray-800 px-2 py-3 text-center">
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {s.value}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
                </div>
              ))}
            </div>
            {actionMsg && (
              <div className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm px-4 py-2 text-center">
                {actionMsg}
              </div>
            )}
            <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-800">
              {students.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Target className="w-10 h-10 mb-3" />
                  <p className="text-sm">暂无今日任务</p>
                </div>
              ) : (
                <div className="p-4 space-y-4">
                  {/* Student card */}
                  {current && (
                    <div
                      className={`rounded-xl border dark:border-gray-700 p-4 ${current.need_help ? 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10' : 'border-gray-200'}`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-lg text-gray-900 dark:text-gray-100">
                              {current.name}
                            </span>
                            {current.need_help && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                需协助
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 font-mono mt-0.5">
                            {current.school_name || '未知学校'}
                          </div>
                          {prediction && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <span className="text-xs text-gray-500">报名概率</span>
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                  prediction.conversion_probability >= 0.7
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                                    : prediction.conversion_probability >= 0.4
                                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                      : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300'
                                }`}
                              >
                                {(prediction.conversion_probability * 100).toFixed(0)}%
                              </span>
                            </div>
                          )}
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[current.status] || STATUS_STYLE['未联系']}`}
                        >
                          {current.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mb-3">
                        {STAGES.map((s, i) => {
                          const idx = STAGES.indexOf(current.stage);
                          return (
                            <button
                              key={s}
                              onClick={() => updateStage(current.id, s)}
                              className={`flex-1 h-1.5 rounded-full transition-all ${i <= idx ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'} ${s === current.stage ? 'ring-2 ring-blue-300' : ''}`}
                              title={s}
                            />
                          );
                        })}
                      </div>
                      {/* Lock banner for follow-up after dial */}
                      {lockedStudentId === current.id && (
                        <div className="mb-3 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg text-center">
                          <div className="text-sm font-bold text-orange-700 dark:text-orange-300 mb-1">
                            ⚠ 请选择本次跟进结果
                          </div>
                          <div className="text-xs text-orange-500">
                            已联系 / 待回访 / 无效 / 已报名
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 mb-3">
                        {QUICK_STATUSES.map((s) => (
                          <button
                            key={s.status}
                            onClick={() => updateStatus(current.id, s.status)}
                            className={`flex items-center gap-1 px-3 py-2 text-white rounded-lg text-xs font-medium ${s.color}`}
                          >
                            <s.icon className="w-3.5 h-3.5" />
                            {s.status}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2 mb-3">
                        <button
                          onClick={() => handleDial('', current.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium"
                        >
                          <Phone className="w-4 h-4" /> 拨号
                        </button>
                        <button
                          onClick={() => openAiPanel(current)}
                          disabled={lockedStudentId === current.id}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Sparkles className="w-4 h-4" /> AI分析
                        </button>
                      </div>
                      <div className="flex gap-2 relative">
                        <button
                          onClick={() => setShowTemplates(!showTemplates)}
                          className="px-2.5 py-2 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg text-sm whitespace-nowrap shrink-0"
                          title="模板消息"
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                        {showTemplates && (
                          <div className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-44 overflow-y-auto">
                            {templates.map((t) => (
                              <button
                                key={t.id}
                                onClick={() => {
                                  setNoteText(t.content);
                                  setShowTemplates(false);
                                }}
                                className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-600 border-b dark:border-gray-600 last:border-0"
                              >
                                <div className="font-medium text-gray-800 dark:text-gray-200 text-xs">
                                  {t.title}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                  {t.content}
                                </div>
                              </button>
                            ))}
                            {templates.length === 0 && (
                              <div className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
                                暂无模板
                              </div>
                            )}
                          </div>
                        )}
                        <input
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addNote()}
                          placeholder="写备注…"
                          className={`flex-1 ${inputCls}`}
                        />
                        <button
                          onClick={addNote}
                          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm"
                        >
                          <StickyNote className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Prev/Next + action buttons */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={prev}
                      disabled={currentIdx === 0 || lockedStudentId !== null}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 border dark:border-gray-700 disabled:opacity-30"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      上一条
                    </button>
                    <span className="text-xs text-gray-500">
                      {currentIdx + 1}/{students.length}
                    </span>
                    <button
                      onClick={next}
                      disabled={currentIdx >= students.length - 1 || lockedStudentId !== null}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 border dark:border-gray-700 disabled:opacity-30"
                    >
                      下一条
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => current && loadDetail(current.id)}
                      disabled={lockedStudentId !== null}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <User className="w-4 h-4" /> 学生详情
                    </button>
                    <button
                      onClick={toggleNeedHelp}
                      disabled={lockedStudentId !== null}
                      className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed ${current?.need_help ? 'bg-red-100 dark:bg-red-900/40 text-red-600' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600'}`}
                    >
                      <AlertTriangle className="w-4 h-4" />{' '}
                      {current?.need_help ? '取消协助' : '需要协助'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            {yesterdayLoading ? (
              <Loader2 className="w-6 h-6 mx-auto animate-spin" />
            ) : yesterdayData ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white dark:bg-gray-800 rounded-xl border p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {yesterdayData.yesterday_calls}
                    </div>
                    <div className="text-xs text-gray-500">昨日呼出</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {yesterdayData.conversion_rate}%
                    </div>
                    <div className="text-xs text-gray-500">转化率</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-400">加载失败</div>
            )}
          </div>
        )}

        {/* Detail slide-up */}
        {showDetail && detailStudent && (
          <div className="fixed inset-0 z-40 bg-white dark:bg-gray-800 flex flex-col">
            <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold">{detailStudent.name}</h3>
              <button onClick={() => setShowDetail(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {detailLoading && (
                <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  加载学生详情...
                </div>
              )}
              {detailError && (
                <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1">{detailError}</span>
                  <button onClick={() => loadDetail(detailStudent.id)} className="font-medium">
                    重试
                  </button>
                </div>
              )}
              {/* Intent level rating */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1.5">意向等级（手动评级）</div>
                <div className="flex gap-2">
                  {['A', 'B', 'C', '无'].map((level) => (
                    <button
                      key={level}
                      onClick={() => updateDetailField('intent_level', level)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        detailStudent.intent_level === level
                          ? level === 'A'
                            ? 'bg-red-100 text-red-700 ring-2 ring-red-300 dark:bg-red-900/40 dark:text-red-300'
                            : level === 'B'
                              ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-300'
                              : level === 'C'
                                ? 'bg-gray-200 text-gray-700 ring-2 ring-gray-300 dark:bg-gray-600 dark:text-gray-200'
                                : 'bg-gray-100 text-gray-500 ring-2 ring-gray-200 dark:bg-gray-700 dark:text-gray-400'
                          : 'bg-white border dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {level === '无' ? '无' : `${level}级`}
                    </button>
                  ))}
                </div>
              </div>
              {/* AI analysis status */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 flex items-center justify-between">
                <span className="text-xs text-gray-500">AI分析状态</span>
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium ${
                    hasAnalysis
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  }`}
                >
                  {hasAnalysis ? '✓ AI分析已完成' : '暂未分析'}
                </span>
              </div>
              {[
                ['score', '成绩'],
                ['guardian_name', '监护人'],
                ['guardian_phone', '监护人电话'],
                ['guardian2_name', '监护人2'],
                ['guardian2_phone', '监护人2电话'],
                ['school_name', '学校'],
              ].map(([k, label]) => (
                <div
                  key={k}
                  className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3"
                >
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className="font-medium mt-0.5">{detailStudent[k] || '-'}</div>
                </div>
              ))}
              {/* Timeline notes */}
              <div className="pt-2 border-t dark:border-gray-700">
                <div className="text-sm font-semibold mb-2">联系记录</div>
                {detailNotesError && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg mb-2">
                    联系记录加载失败：{detailNotesError}
                  </div>
                )}
                {detailNotes.length === 0 ? (
                  <div className="text-xs text-gray-400 py-4 text-center">暂无联系记录</div>
                ) : (
                  <>
                    <div className="flex gap-3 py-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">
                            {detailNotes[noteIdx].agent_name}
                          </span>
                          <span className="text-xs text-gray-400">
                            {detailNotes[noteIdx].created_at}
                          </span>
                        </div>
                        <div className="text-sm mt-1 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {detailNotes[noteIdx].content}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <button
                        onClick={() => setNoteIdx(noteIdx - 1)}
                        disabled={noteIdx === 0}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 disabled:opacity-30"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        上一条
                      </button>
                      <span className="text-xs text-gray-400">
                        {noteIdx + 1}/{detailNotes.length}
                      </span>
                      <button
                        onClick={() => setNoteIdx(noteIdx + 1)}
                        disabled={noteIdx >= detailNotes.length - 1}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 disabled:opacity-30"
                      >
                        下一条
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Bottom nav */}
        <nav className="shrink-0 bg-white dark:bg-gray-800 border-t dark:border-gray-700 flex safe-bottom">
          <button
            onClick={() => setViewTab('today')}
            className={`flex-1 flex flex-col items-center py-2 gap-0.5 ${viewTab === 'today' ? 'text-green-600' : 'text-gray-400'}`}
          >
            <Target className="w-5 h-5" />
            <span className="text-xs">今日任务</span>
          </button>
          <button
            onClick={() => {
              setViewTab('yesterday');
              fetchYesterday();
            }}
            className={`flex-1 flex flex-col items-center py-2 gap-0.5 ${viewTab === 'yesterday' ? 'text-green-600' : 'text-gray-400'}`}
          >
            <History className="w-5 h-5" />
            <span className="text-xs">昨日回顾</span>
          </button>
        </nav>
        {showAi && (
          <div className="fixed inset-0 z-40 bg-white dark:bg-gray-800 flex flex-col">
            <AiPanel
              activeStudent={activeStudent}
              onClose={() => setShowAi(false)}
              onStatusUpdate={updateStatus}
            />
          </div>
        )}
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-900">
      <aside className="w-60 shrink-0 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col">
        <div className="flex items-center gap-3 px-4 h-14 border-b dark:border-gray-700">
          <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center">
            <Phone className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">话务工作台</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{user?.name}</div>
          </div>
        </div>
        <Sidebar />
      </aside>
      <div className="flex-1 flex min-w-0">
        {showCreate && (
          <StudentCreateModal
            student={newStudent}
            setStudent={setNewStudent}
            error={createErr}
            onClose={() => setShowCreate(false)}
            onSubmit={handleCreate}
          />
        )}
        <div className="flex-1 flex flex-col min-w-0 max-w-xl border-r dark:border-gray-700">
          <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between shrink-0">
            <h2 className="text-sm font-semibold">
              {viewTab === 'today' ? '今日任务' : '昨日回顾'}
            </h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setHelpOpen(true)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="使用说明"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setShowCreate(true);
                  setCreateErr('');
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors"
                title="手动添加学生"
              >
                <Plus className="w-4 h-4" />
              </button>
            {viewTab === 'today' && (
              <span className="text-xs text-gray-500">
                {stats.done}/{stats.total}
              </span>
            )}
            </div>
          </header>
          {viewTab === 'today' ? (
            <>
              <div className="bg-white dark:bg-gray-800 px-4 py-2 shrink-0 border-b dark:border-gray-700">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>完成进度</span>
                  <span>{stats.progress_pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${stats.progress_pct}%` }}
                  />
                </div>
              </div>
              {actionMsg && (
                <div className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm px-4 py-2 text-center">
                  {actionMsg}
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {students.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <Target className="w-10 h-10 mb-3" />
                    <p className="text-sm">暂无今日任务</p>
                  </div>
                ) : (
                  current && (
                    <div className="p-4 space-y-4">
                      <div
                        className={`rounded-xl border p-4 ${current.need_help ? 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10' : 'bg-white dark:bg-gray-800 dark:border-gray-700'}`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-lg">{current.name}</span>
                              {current.need_help && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  需协助
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500 font-mono mt-0.5">
                              {current.school_name || '未知学校'}
                            </div>
                            {prediction && (
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <span className="text-xs text-gray-500">报名概率</span>
                                <span
                                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${prediction.conversion_probability >= 0.7 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : prediction.conversion_probability >= 0.4 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300'}`}
                                >
                                  {(prediction.conversion_probability * 100).toFixed(0)}%
                                </span>
                              </div>
                            )}
                          </div>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[current.status]}`}
                          >
                            {current.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mb-3">
                          {STAGES.map((s, i) => {
                            const idx = STAGES.indexOf(current.stage);
                            return (
                              <button
                                key={s}
                                onClick={() => updateStage(current.id, s)}
                                className={`flex-1 h-1.5 rounded-full transition-all ${i <= idx ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'} ${s === current.stage ? 'ring-2 ring-blue-300' : ''}`}
                                title={s}
                              />
                            );
                          })}
                        </div>
                        {/* Lock banner for follow-up after dial */}
                        {lockedStudentId === current.id && (
                          <div className="mb-3 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg text-center">
                            <div className="text-sm font-bold text-orange-700 dark:text-orange-300 mb-1">
                              ⚠ 请选择本次跟进结果
                            </div>
                            <div className="text-xs text-orange-500">
                              已联系 / 待回访 / 无效 / 已报名
                            </div>
                          </div>
                        )}
                        <div className="flex gap-2 mb-3">
                          {QUICK_STATUSES.map((s) => (
                            <button
                              key={s.status}
                              onClick={() => updateStatus(current.id, s.status)}
                              className={`flex items-center gap-1 px-3 py-2 text-white rounded-lg text-xs font-medium ${s.color}`}
                            >
                              <s.icon className="w-3.5 h-3.5" />
                              {s.status}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2 mb-3">
                          <button
                            onClick={() => handleDial('', current.id)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-green-600 text-white rounded-lg text-sm"
                          >
                            拨号
                          </button>
                          <button
                            onClick={() => openAiPanel(current)}
                            disabled={lockedStudentId === current.id}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-purple-600 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            AI分析
                          </button>
                        </div>
                        <div className="flex gap-2 relative">
                          <button
                            onClick={() => setShowTemplates(!showTemplates)}
                            className="px-2.5 py-2 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg text-sm shrink-0"
                            title="模板消息"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>
                          {showTemplates && (
                            <div className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-44 overflow-y-auto">
                              {templates.map((t) => (
                                <button
                                  key={t.id}
                                  onClick={() => {
                                    setNoteText(t.content);
                                    setShowTemplates(false);
                                  }}
                                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-600 border-b dark:border-gray-600 last:border-0"
                                >
                                  <div className="font-medium text-gray-800 dark:text-gray-200 text-xs">
                                    {t.title}
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                    {t.content}
                                  </div>
                                </button>
                              ))}
                              {templates.length === 0 && (
                                <div className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
                                  暂无模板
                                </div>
                              )}
                            </div>
                          )}
                          <input
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addNote()}
                            placeholder="写备注，回车发送…"
                            className={`flex-1 ${inputCls}`}
                          />
                          <button
                            onClick={addNote}
                            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm"
                          >
                            <StickyNote className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <button
                          onClick={prev}
                          disabled={currentIdx === 0 || lockedStudentId !== null}
                          className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 border dark:border-gray-700 disabled:opacity-30"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          上一条
                        </button>
                        <span className="text-xs text-gray-500">
                          {currentIdx + 1}/{students.length}
                        </span>
                        <button
                          onClick={next}
                          disabled={currentIdx >= students.length - 1 || lockedStudentId !== null}
                          className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 border dark:border-gray-700 disabled:opacity-30"
                        >
                          下一条
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => current && loadDetail(current.id)}
                          disabled={lockedStudentId !== null}
                          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <User className="w-4 h-4" /> 学生详情
                        </button>
                        <button
                          onClick={toggleNeedHelp}
                          disabled={lockedStudentId !== null}
                          className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed ${current?.need_help ? 'bg-red-100 dark:bg-red-900/40 text-red-600' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600'}`}
                        >
                          <AlertTriangle className="w-4 h-4" />{' '}
                          {current?.need_help ? '取消协助' : '需要协助'}
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              {yesterdayLoading ? (
                <Loader2 className="w-6 h-6 mx-auto animate-spin" />
              ) : yesterdayData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white dark:bg-gray-800 rounded-xl border p-4 text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {yesterdayData.yesterday_calls}
                      </div>
                      <div className="text-xs text-gray-500">昨日呼出</div>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl border p-4 text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {yesterdayData.conversion_rate}%
                      </div>
                      <div className="text-xs text-gray-500">转化率</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-400">加载失败</div>
              )}
            </div>
          )}
        </div>
        {/* Right: detail panel + AI */}
        <div className="flex-1 flex-col bg-white dark:bg-gray-800 hidden lg:flex">
          {showDetail && detailStudent ? (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
                <h3 className="font-semibold">{detailStudent.name} 详情</h3>
                <button onClick={() => setShowDetail(false)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {detailLoading && (
                  <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    加载学生详情...
                  </div>
                )}
                {detailError && (
                  <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1">{detailError}</span>
                    <button onClick={() => loadDetail(detailStudent.id)} className="font-medium">
                      重试
                    </button>
                  </div>
                )}
                {/* Intent level rating */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1.5">意向等级（手动评级）</div>
                  <div className="flex gap-2">
                    {['A', 'B', 'C', '无'].map((level) => (
                      <button
                        key={level}
                        onClick={() => updateDetailField('intent_level', level)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          detailStudent.intent_level === level
                            ? level === 'A'
                              ? 'bg-red-100 text-red-700 ring-2 ring-red-300 dark:bg-red-900/40 dark:text-red-300'
                              : level === 'B'
                                ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-300'
                                : level === 'C'
                                  ? 'bg-gray-200 text-gray-700 ring-2 ring-gray-300 dark:bg-gray-600 dark:text-gray-200'
                                  : 'bg-gray-100 text-gray-500 ring-2 ring-gray-200 dark:bg-gray-700 dark:text-gray-400'
                            : 'bg-white border dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {level === '无' ? '无' : `${level}级`}
                      </button>
                    ))}
                  </div>
                </div>
                {/* AI analysis status */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 flex items-center justify-between">
                  <span className="text-xs text-gray-500">AI分析状态</span>
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      hasAnalysis
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {hasAnalysis ? '✓ AI分析已完成' : '暂未分析'}
                  </span>
                </div>
                {[
                  ['score', '成绩'],
                  ['guardian_name', '监护人'],
                  ['guardian_phone', '监护人电话'],
                  ['guardian2_name', '监护人2'],
                  ['guardian2_phone', '监护人2电话'],
                  ['school_name', '学校'],
                ].map(([k, label]) => (
                  <div
                    key={k}
                    className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3"
                  >
                    <div className="text-xs text-gray-500">{label}</div>
                    <div className="font-medium mt-0.5">{detailStudent[k] || '-'}</div>
                  </div>
                ))}
                <div className="pt-2 border-t dark:border-gray-700">
                  <div className="text-sm font-semibold mb-2">联系记录</div>
                  {detailNotesError && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg mb-2">
                      联系记录加载失败：{detailNotesError}
                    </div>
                  )}
                  {detailNotes.length === 0 ? (
                    <div className="text-xs text-gray-400 py-4 text-center">暂无</div>
                  ) : (
                    <>
                      <div className="flex gap-3 py-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">
                              {detailNotes[noteIdx].agent_name}
                            </span>
                            <span className="text-xs text-gray-400">
                              {detailNotes[noteIdx].created_at}
                            </span>
                          </div>
                          <div className="text-sm mt-1 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {detailNotes[noteIdx].content}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <button
                          onClick={() => setNoteIdx(noteIdx - 1)}
                          disabled={noteIdx === 0}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 disabled:opacity-30"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          上一条
                        </button>
                        <span className="text-xs text-gray-400">
                          {noteIdx + 1}/{detailNotes.length}
                        </span>
                        <button
                          onClick={() => setNoteIdx(noteIdx + 1)}
                          disabled={noteIdx >= detailNotes.length - 1}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 disabled:opacity-30"
                        >
                          下一条
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : showAi ? (
            <AiPanel
              activeStudent={activeStudent}
              onClose={() => setShowAi(false)}
              onStatusUpdate={updateStatus}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 dark:text-gray-600">
              <Sparkles className="w-12 h-12 mb-3" />
              <p>选择学生查看详情或AI分析</p>
            </div>
          )}
        </div>
        {showDetail && detailStudent && (
          <div className="fixed inset-0 z-40 bg-white dark:bg-gray-800 flex flex-col lg:hidden">
            <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold">{detailStudent.name || '学生详情'}</h3>
              <button onClick={() => setShowDetail(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {detailLoading && (
                <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  加载学生详情...
                </div>
              )}
              {detailError && (
                <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1">{detailError}</span>
                  <button onClick={() => loadDetail(detailStudent.id)} className="font-medium">
                    重试
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['region', '地域'],
                  ['status', '状态'],
                  ['intent_level', '意向'],
                  ['stage', '阶段'],
                  ['score', '成绩'],
                  ['guardian_name', '监护人'],
                  ['guardian_phone', '监护人电话'],
                  ['guardian2_name', '监护人2'],
                  ['guardian2_phone', '监护人2电话'],
                  ['school_name', '学校'],
                ].map(([k, label]) => (
                  <div key={k} className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 min-w-0">
                    <div className="text-xs text-gray-500">{label}</div>
                    <div className="font-medium mt-0.5 break-words">{detailStudent[k] || '-'}</div>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t dark:border-gray-700">
                <div className="text-sm font-semibold mb-2">联系记录</div>
                {detailNotesError && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg mb-2">
                    联系记录加载失败：{detailNotesError}
                  </div>
                )}
                {detailNotes.length === 0 ? (
                  <div className="text-xs text-gray-400 py-4 text-center">暂无联系记录</div>
                ) : (
                  <>
                    <div className="flex gap-3 py-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{detailNotes[noteIdx].agent_name}</span>
                          <span className="text-xs text-gray-400">{detailNotes[noteIdx].created_at}</span>
                        </div>
                        <div className="text-sm mt-1 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {detailNotes[noteIdx].content}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <button
                        onClick={() => setNoteIdx(noteIdx - 1)}
                        disabled={noteIdx === 0}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 disabled:opacity-30"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        上一条
                      </button>
                      <span className="text-xs text-gray-400">
                        {noteIdx + 1}/{detailNotes.length}
                      </span>
                      <button
                        onClick={() => setNoteIdx(noteIdx + 1)}
                        disabled={noteIdx >= detailNotes.length - 1}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-700 disabled:opacity-30"
                      >
                        下一条
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StudentCreateModal({ student, setStudent, error, onClose, onSubmit }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-white dark:bg-gray-800 z-10 pb-2">
          <h3 className="text-lg font-semibold">手动添加学生</h3>
          <button onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {createStudentFields.map((field) => (
            <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <label className="block text-sm mb-1">
                {field.label} {field.required && '*'}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  value={student[field.key] || ''}
                  onChange={(e) => setStudent({ ...student, [field.key]: e.target.value })}
                  className={`${inputCls} h-20 resize-none`}
                  rows={3}
                />
              ) : (
                <input
                  value={student[field.key] || ''}
                  onChange={(e) => setStudent({ ...student, [field.key]: e.target.value })}
                  className={inputCls}
                  type={field.type || 'text'}
                />
              )}
            </div>
          ))}
          <div className="sm:col-span-2 text-xs text-gray-500 dark:text-gray-400">
            添加后会自动分配到当前话务员，话务员不能删除学生。
          </div>
          {error && (
            <div className="sm:col-span-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
          <button onClick={onSubmit} className="sm:col-span-2 w-full py-2.5 bg-green-600 text-white rounded-lg text-sm">
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

function AiPanel({ activeStudent, onClose, onStatusUpdate }) {
  const { dark } = useTheme();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const handleAnalyzeLocal = async () => {
    if (!text.trim() || !activeStudent) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await api.post('/calls/analyze', {
        student_id: activeStudent.id,
        transcript: text,
      });
      if (res.data.code === 0) {
        setResult(res.data.data);
        onStatusUpdate(activeStudent.id, '已联系');
        setTimeout(
          () => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }),
          100,
        );
      } else setError(res.data.msg || '分析失败');
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  };

  const intentColors = {
    A: 'bg-red-100 text-red-700 border-red-300',
    B: 'bg-amber-100 text-amber-700 border-amber-300',
    C: 'bg-gray-100 text-gray-600 border-gray-300',
    无: 'bg-gray-50 text-gray-400 border-gray-200',
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
        <h3 className="font-semibold">AI 通话分析</h3>
        <button onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
            通话转录文本
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-36 border dark:border-gray-600 rounded-lg p-3 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 resize-none outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="粘贴通话内容或手动输入对话摘要…"
          />
        </div>
        <button
          onClick={handleAnalyzeLocal}
          disabled={loading || !text.trim()}
          className="w-full py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {loading ? '分析中…' : '开始分析'}
        </button>
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg">
            {error}
          </div>
        )}
        {result && (
          <div ref={bottomRef} className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <span className="text-xs text-gray-500">意向等级</span>
              <span
                className={`text-lg font-bold px-3 py-1 rounded-lg border ${intentColors[result.ai_intent] || intentColors['无']}`}
              >
                {result.ai_intent}级
              </span>
              <span className="text-xs text-gray-400 ml-auto">
                置信度 {(result.ai_confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">摘要</div>
              <div className="text-sm text-gray-800 dark:text-gray-200">{result.ai_summary}</div>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">判断依据</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{result.ai_reasons}</div>
            </div>
          </div>
        )}
      </div>
      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
