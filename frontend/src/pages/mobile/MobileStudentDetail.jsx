import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  Phone,
  StickyNote,
  Calendar,
  MapPin,
  Loader2,
  AlertTriangle,
  Sparkles,
  X,
  Pencil,
  Trash2,
} from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import IntentLevelBadge from '../../components/IntentLevelBadge';
import StudentInfoCard from '../../components/StudentInfoCard';
import TimelineItem from '../../components/TimelineItem';
import MobileDialResult from '../../components/MobileDialResult';
import useDialFlow from '../../hooks/useDialFlow';
import { useConfirm } from '../../components/ConfirmDialog';
import { getApiErrorMessage } from '../../utils';
import {
  detailForOperatorResult,
  displayStatusForOperatorResult,
  OPERATOR_STATUS_BUTTON_LABELS,
  STAGES,
  STATUS_ACTION_BUTTON_CLASSES,
  stageLabel,
} from '../../labels';
const INTENT_LEVELS = ['A', 'B', 'C', '无'];
const VISIT_STATUSES = ['待确认', '已确认', '已完成', '已取消'];

function normalizeDateTimeLocal(value) {
  if (!value) return '';
  const s = String(value).replace(' ', 'T');
  return s.length >= 16 ? s.slice(0, 16) : s;
}

function toApiDateTime(value) {
  if (!value) return '';
  return value.length === 16 ? `${value}:00` : value;
}

// 默认到访时间：明天上午 10 点，<input type="datetime-local"> 格式
function defaultVisitDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function VisitSheet({ open, onClose, onSubmit, submitting }) {
  const [visitType, setVisitType] = useState('来校参观');
  const [date, setDate] = useState(defaultVisitDate);
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setVisitType('来校参观');
      setDate(defaultVisitDate());
      setNotes('');
    }
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-white dark:bg-gray-900 rounded-t-2xl p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">登记到访</h3>
          <button onClick={onClose} className="text-gray-400 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-2">
          {['来校参观', '家访'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setVisitType(t)}
              className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium border ${
                visitType === t
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full border dark:border-gray-600 rounded-lg p-3 text-base bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full h-20 border dark:border-gray-600 rounded-lg p-3 text-base bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500 resize-none"
          placeholder="到访备注（可选）"
        />
        <button
          type="button"
          disabled={!date || submitting}
          onClick={() => onSubmit({ visit_type: visitType, scheduled_date: date, notes })}
          className="w-full min-h-[48px] bg-teal-600 text-white rounded-lg text-base font-medium disabled:opacity-50"
        >
          {submitting ? '提交中…' : '保存到访'}
        </button>
      </div>
    </div>
  );
}

function NoteSheet({ open, onClose, onSubmit, submitting, initialText = '', title = '写备注' }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText(initialText);
  }, [open, initialText]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-white dark:bg-gray-900 rounded-t-2xl p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="text-gray-400 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full h-32 border dark:border-gray-600 rounded-lg p-3 text-base bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder="记录学员情况、跟进要点…"
        />
        <button
          type="button"
          disabled={!text.trim() || submitting}
          onClick={() => onSubmit(text.trim())}
          className="w-full min-h-[48px] bg-blue-600 text-white rounded-lg text-base font-medium disabled:opacity-50"
        >
          {submitting ? '提交中…' : '提交备注'}
        </button>
      </div>
    </div>
  );
}

function DateTimeSheet({
  open,
  onClose,
  onSubmit,
  submitting,
  title,
  label,
  submitText,
  initialValue = '',
}) {
  const [date, setDate] = useState('');
  useEffect(() => {
    if (open) setDate(normalizeDateTimeLocal(initialValue));
  }, [open, initialValue]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-white dark:bg-gray-900 rounded-t-2xl p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="text-gray-400 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-300">
          {label}
          <input
            aria-label={label}
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-2 w-full border dark:border-gray-600 rounded-lg p-3 text-base bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <button
          type="button"
          disabled={!date || submitting}
          onClick={() => onSubmit(date)}
          className="w-full min-h-[48px] bg-blue-600 text-white rounded-lg text-base font-medium disabled:opacity-50"
        >
          {submitting ? '提交中…' : submitText}
        </button>
      </div>
    </div>
  );
}

export default function MobileStudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { dial } = useDialFlow();
  const { user } = useAuth();
  const confirm = useConfirm();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  const [visitSubmitting, setVisitSubmitting] = useState(false);
  const [editNote, setEditNote] = useState(null); // { id, content }
  const [editNoteSubmitting, setEditNoteSubmitting] = useState(false);
  const [editFollowUp, setEditFollowUp] = useState(null);
  const [editVisit, setEditVisit] = useState(null);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [dialing, setDialing] = useState(false);
  const [toast, setToast] = useState('');

  const isAdmin = user?.role === 'admin';
  const canModify = (item) => isAdmin || item?.agent_id === user?.id;

  const loadDetail = () => {
    setLoading(true);
    setError('');
    api
      .get(`/students/${id}/detail`)
      .then((res) => setData(res.data.data || res.data))
      .catch((e) => setError(getApiErrorMessage(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const student = data?.student;
  const calls = data?.calls || [];
  const notes = data?.notes || [];
  const followUps = data?.follow_ups || [];
  const visits = data?.visits || [];

  const merged = useMemo(() => {
    const items = [];
    calls.forEach((c) => items.push({ kind: 'call', ts: c.created_at || c.call_time, d: c }));
    notes.forEach((n) => items.push({ kind: 'note', ts: n.created_at, d: n }));
    followUps.forEach((f) =>
      items.push({ kind: 'follow_up', ts: f.created_at || f.follow_up_date, d: f }),
    );
    visits.forEach((v) => items.push({ kind: 'visit', ts: v.created_at || v.visit_date, d: v }));
    return items.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  }, [calls, notes, followUps, visits]);

  const showToast = (m) => {
    setToast(m);
    setTimeout(() => setToast(''), 2200);
  };

  const patchStudent = (patch) => {
    setData((prev) => {
      if (!prev?.student) return prev;
      return { ...prev, student: { ...prev.student, ...patch } };
    });
  };

  const patchFollowUp = (fuId, patch) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        follow_ups: (prev.follow_ups || []).map((fu) =>
          fu.id === fuId ? { ...fu, ...patch } : fu,
        ),
      };
    });
  };

  const patchVisit = (visitId, patch) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        visits: (prev.visits || []).map((visit) =>
          visit.id === visitId ? { ...visit, ...patch } : visit,
        ),
      };
    });
  };

  const runWorkflowUpdate = async (request, successMessage, onSuccess) => {
    if (workflowSaving) return;
    setWorkflowSaving(true);
    try {
      const r = await request();
      if (r.data.code === 0) {
        onSuccess?.(r.data.data);
        showToast(successMessage);
      } else {
        showToast(r.data.msg || '更新失败');
      }
    } catch (e) {
      showToast(getApiErrorMessage(e));
    } finally {
      setWorkflowSaving(false);
    }
  };

  const handleDial = async () => {
    if (!student) return;
    setDialing(true);
    try {
      await dial(student.id, { studentName: student.name });
    } finally {
      setDialing(false);
    }
  };

  const handleSubmitNote = async (content) => {
    setNoteSubmitting(true);
    try {
      const r = await api.post('/notes', { student_id: Number(id), content });
      if (r.data.code === 0) {
        setNoteOpen(false);
        showToast('备注已保存');
        loadDetail();
      } else {
        showToast(r.data.msg || '保存失败');
      }
    } catch (e) {
      showToast(getApiErrorMessage(e));
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleSubmitVisit = async ({ visit_type, scheduled_date, notes }) => {
    setVisitSubmitting(true);
    try {
      const r = await api.post('/visits', {
        student_id: Number(id),
        visit_type,
        scheduled_date: scheduled_date.length === 16 ? scheduled_date + ':00' : scheduled_date,
        notes,
      });
      if (r.data.code === 0) {
        setVisitOpen(false);
        showToast('到访已登记');
        loadDetail();
      } else {
        showToast(r.data.msg || '登记失败');
      }
    } catch (e) {
      showToast(getApiErrorMessage(e));
    } finally {
      setVisitSubmitting(false);
    }
  };

  const handleUpdateStudentStatus = async (status) => {
    if (!student) return;
    if (status === '已报名') {
      const ok = await confirm({
        title: '确认报名',
        message: '确认将此学生标记为已报名？阶段也会同步更新为已报名。',
        confirmText: '确认报名',
      });
      if (!ok) return;
    }
    runWorkflowUpdate(
      () => api.put(`/students/${student.id}`, { status }),
      '联系状态已更新',
      (updated) => {
        const nextStatus = updated?.status || displayStatusForOperatorResult(status);
        const nextDetail = updated?.status_detail ?? detailForOperatorResult(status);
        patchStudent({
          status: nextStatus,
          status_detail: nextDetail,
          stage: updated?.stage || (nextStatus === '已报名' ? '已报名' : student.stage),
        });
      },
    );
  };

  const handleUpdateStudentStage = (stage) => {
    if (!student || student.stage === stage) return;
    runWorkflowUpdate(
      () => api.put(`/students/${student.id}/stage`, { stage }),
      '阶段已更新',
      () => patchStudent({ stage, status: stage === '已报名' ? '已报名' : student.status }),
    );
  };

  const handleUpdateIntent = (intent_level) => {
    if (!student || student.intent_level === intent_level) return;
    runWorkflowUpdate(
      () => api.put(`/students/${student.id}`, { intent_level }),
      '意向等级已更新',
      () => patchStudent({ intent_level }),
    );
  };

  const handleCompleteFollowUp = (followUp) => {
    runWorkflowUpdate(
      () => api.put(`/follow-ups/${followUp.id}`, { is_completed: true }),
      '回访已完成',
      () => patchFollowUp(followUp.id, { is_completed: true }),
    );
  };

  const handleRescheduleFollowUp = (date) => {
    if (!editFollowUp) return;
    const follow_up_date = toApiDateTime(date);
    runWorkflowUpdate(
      () => api.put(`/follow-ups/${editFollowUp.id}`, { follow_up_date }),
      '回访时间已更新',
      () => {
        patchFollowUp(editFollowUp.id, { follow_up_date });
        setEditFollowUp(null);
      },
    );
  };

  const handleUpdateVisitStatus = (visit, status) => {
    if (visit.status === status) return;
    runWorkflowUpdate(
      () => api.put(`/visits/${visit.id}`, { status }),
      '到访状态已更新',
      () => patchVisit(visit.id, { status }),
    );
  };

  const handleRescheduleVisit = (date) => {
    if (!editVisit) return;
    const scheduled_date = toApiDateTime(date);
    runWorkflowUpdate(
      () => api.put(`/visits/${editVisit.id}`, { scheduled_date }),
      '到访时间已更新',
      () => {
        patchVisit(editVisit.id, { scheduled_date });
        setEditVisit(null);
      },
    );
  };

  const handleEditNote = async (content) => {
    if (!editNote) return;
    setEditNoteSubmitting(true);
    try {
      const r = await api.put(`/notes/${editNote.id}`, { content });
      if (r.data.code === 0) {
        setEditNote(null);
        showToast('备注已更新');
        loadDetail();
      } else {
        showToast(r.data.msg || '更新失败');
      }
    } catch (e) {
      showToast(getApiErrorMessage(e));
    } finally {
      setEditNoteSubmitting(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (busyDelete) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm('确定删除这条备注吗？')) return;
    setBusyDelete(true);
    try {
      const r = await api.delete(`/notes/${noteId}`);
      if (r.data.code === 0) {
        showToast('备注已删除');
        loadDetail();
      } else {
        showToast(r.data.msg || '删除失败');
      }
    } catch (e) {
      showToast(getApiErrorMessage(e));
    } finally {
      setBusyDelete(false);
    }
  };

  const handleDeleteVisit = async (visitId) => {
    if (busyDelete) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm('确定删除这条到访记录吗？')) return;
    setBusyDelete(true);
    try {
      const r = await api.delete(`/visits/${visitId}`);
      if (r.data.code === 0) {
        showToast('到访已删除');
        loadDetail();
      } else {
        showToast(r.data.msg || '删除失败');
      }
    } catch (e) {
      showToast(getApiErrorMessage(e));
    } finally {
      setBusyDelete(false);
    }
  };

  const handleDeleteFollowUp = async (fuId) => {
    if (busyDelete) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm('确定删除这条回访计划吗？')) return;
    setBusyDelete(true);
    try {
      const r = await api.delete(`/follow-ups/${fuId}`);
      if (r.data.code === 0) {
        showToast('回访计划已删除');
        loadDetail();
      } else {
        showToast(r.data.msg || '删除失败');
      }
    } catch (e) {
      showToast(getApiErrorMessage(e));
    } finally {
      setBusyDelete(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-gray-900 px-4">
        <AlertTriangle className="w-10 h-10 text-red-500" />
        <div className="text-gray-600 dark:text-gray-300 text-center">{error || '未找到该学生'}</div>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm min-h-[44px]"
        >
          返回
        </button>
      </div>
    );
  }

  const renderTimelineItem = (item) => {
    const { kind, d } = item;
    if (kind === 'call') {
      return (
        <TimelineItem
          key={`call-${d.id}`}
          type="通话"
          icon={Phone}
          color="blue"
          title={`通话${d.duration ? ` · ${d.duration}秒` : ''}`}
          content={d.ai_summary || d.content || d.notes || ''}
          agentName={d.agent_name}
          timestamp={d.created_at || d.call_time}
        />
      );
    }
    if (kind === 'note') {
      return (
        <div key={`note-${d.id}`} className="relative group">
          <TimelineItem
            type="备注"
            icon={StickyNote}
            color={d.source === 'ai' ? 'purple' : 'gray'}
            title="备注"
            content={d.content}
            agentName={d.agent_name}
            timestamp={d.created_at}
            source={d.source}
          />
          {d.source !== 'ai' && canModify(d) && (
            <div className="flex gap-3 mt-1 ml-9 text-xs">
              <button
                type="button"
                onClick={() => setEditNote({ id: d.id, content: d.content })}
                className="inline-flex items-center gap-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <Pencil className="w-3 h-3" /> 编辑
              </button>
              <button
                type="button"
                disabled={busyDelete}
                onClick={() => handleDeleteNote(d.id)}
                className="inline-flex items-center gap-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" /> 删除
              </button>
            </div>
          )}
        </div>
      );
    }
    if (kind === 'follow_up') {
      return (
        <div key={`fu-${d.id}`} data-testid={`follow-up-${d.id}`} className="relative">
          <TimelineItem
            type="回访"
            icon={Calendar}
            color="amber"
            title={`回访计划 · ${d.follow_up_date || ''}`}
            content={d.notes || d.note || d.content || ''}
            agentName={d.agent_name}
            timestamp={d.created_at}
          />
          {canModify(d) && (
            <div className="flex flex-wrap gap-3 mt-1 ml-9 text-xs">
              {!d.is_completed && (
                <button
                  type="button"
                  disabled={workflowSaving}
                  onClick={() => handleCompleteFollowUp(d)}
                  className="inline-flex items-center gap-1 text-gray-500 hover:text-green-600 dark:hover:text-green-400 disabled:opacity-50"
                >
                  完成回访
                </button>
              )}
              <button
                type="button"
                disabled={workflowSaving}
                onClick={() => setEditFollowUp(d)}
                className="inline-flex items-center gap-1 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50"
              >
                <Pencil className="w-3 h-3" /> 改期
              </button>
              <button
                type="button"
                disabled={busyDelete}
                onClick={() => handleDeleteFollowUp(d.id)}
                className="inline-flex items-center gap-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" /> 删除
              </button>
            </div>
          )}
        </div>
      );
    }
    if (kind === 'visit') {
      return (
        <div key={`v-${d.id}`} data-testid={`visit-${d.id}`} className="relative">
          <TimelineItem
            type="到访"
            icon={MapPin}
            color="teal"
            title={`${d.visit_type || '到访'} · ${d.status || '待确认'} · ${
              d.visit_date || d.scheduled_date || ''
            }`}
            content={d.notes || d.note || d.content || ''}
            agentName={d.agent_name}
            timestamp={d.created_at}
          />
          {canModify(d) && (
            <div className="flex flex-wrap gap-2 mt-1 ml-9 text-xs">
              {VISIT_STATUSES.filter((status) => status !== d.status).map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={workflowSaving}
                  onClick={() => handleUpdateVisitStatus(d, status)}
                  className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-gray-500 hover:text-teal-700 hover:border-teal-300 dark:hover:text-teal-300 disabled:opacity-50"
                >
                  {status}
                </button>
              ))}
              <button
                type="button"
                disabled={workflowSaving}
                onClick={() => setEditVisit(d)}
                className="inline-flex items-center gap-1 px-2 py-1 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50"
              >
                <Pencil className="w-3 h-3" /> 改期
              </button>
              <button
                type="button"
                disabled={busyDelete}
                onClick={() => handleDeleteVisit(d.id)}
                className="inline-flex items-center gap-1 px-2 py-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" /> 删除
              </button>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-[calc(env(safe-area-inset-bottom)+88px)]">
      <header className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-3 py-3 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-700"
          aria-label="返回"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
            {student.name}
          </h1>
          <StatusBadge status={student.status} />
          <IntentLevelBadge level={student.intent_level} />
        </div>
      </header>

      <div className="p-3 space-y-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4">
          <StudentInfoCard student={student} />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4 space-y-4">
          <div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
              处理结果
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="处理结果">
              {OPERATOR_STATUS_BUTTON_LABELS.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={workflowSaving}
                  onClick={() => handleUpdateStudentStatus(status)}
                  className={`min-h-[42px] rounded-lg px-2 text-sm font-medium text-white ${
                    STATUS_ACTION_BUTTON_CLASSES[status]
                  } disabled:opacity-60`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
              跟进阶段
            </div>
            <div className="grid grid-cols-3 gap-2">
              {STAGES.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  disabled={workflowSaving || student.stage === stage}
                  onClick={() => handleUpdateStudentStage(stage)}
                  className={`min-h-[40px] rounded-lg border text-sm font-medium ${
                    student.stage === stage
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                  } disabled:opacity-80`}
                >
                  {stageLabel(stage)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
              意向等级
            </div>
            <div className="grid grid-cols-4 gap-2">
              {INTENT_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  disabled={workflowSaving || (student.intent_level || '无') === level}
                  onClick={() => handleUpdateIntent(level)}
                  className={`min-h-[40px] rounded-lg border text-sm font-medium ${
                    (student.intent_level || '无') === level
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                  } disabled:opacity-80`}
                >
                  {level === '无' ? '无' : `${level} 级`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4">
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            完整时间线
          </div>
          {merged.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">暂无记录</div>
          ) : (
            <div className="space-y-4">{merged.map((it) => renderTimelineItem(it))}</div>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t dark:border-gray-700 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)] flex gap-2">
        <button
          type="button"
          onClick={handleDial}
          disabled={dialing}
          className="flex-1 min-h-[52px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-60 active:scale-95"
        >
          {dialing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Phone className="w-5 h-5" />}
          拨号
        </button>
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="px-4 min-h-[52px] rounded-xl border dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium active:scale-95"
        >
          写备注
        </button>
        <button
          type="button"
          onClick={() => setVisitOpen(true)}
          className="px-4 min-h-[52px] rounded-xl border border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300 text-sm font-medium active:scale-95"
        >
          到访
        </button>
        <button
          type="button"
          onClick={() => navigate(`/mobile/call/${student.id}`)}
          className="px-4 min-h-[52px] rounded-xl bg-purple-600 text-white text-sm font-medium active:scale-95"
        >
          填通话
        </button>
      </div>

      <NoteSheet
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        onSubmit={handleSubmitNote}
        submitting={noteSubmitting}
      />

      <NoteSheet
        open={!!editNote}
        title="编辑备注"
        initialText={editNote?.content || ''}
        onClose={() => setEditNote(null)}
        onSubmit={handleEditNote}
        submitting={editNoteSubmitting}
      />

      <VisitSheet
        open={visitOpen}
        onClose={() => setVisitOpen(false)}
        onSubmit={handleSubmitVisit}
        submitting={visitSubmitting}
      />

      <DateTimeSheet
        open={!!editFollowUp}
        onClose={() => setEditFollowUp(null)}
        onSubmit={handleRescheduleFollowUp}
        submitting={workflowSaving}
        title="回访改期"
        label="回访时间"
        submitText="保存回访"
        initialValue={editFollowUp?.follow_up_date || ''}
      />

      <DateTimeSheet
        open={!!editVisit}
        onClose={() => setEditVisit(null)}
        onSubmit={handleRescheduleVisit}
        submitting={workflowSaving}
        title="到访改期"
        label="到访时间"
        submitText="保存到访"
        initialValue={editVisit?.scheduled_date || editVisit?.visit_date || ''}
      />

      {/* 打完电话返回后弹“选择处理结果”，更新联系状况 */}
      <MobileDialResult onUpdated={() => loadDetail()} />

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-gray-900/90 text-white text-sm px-4 py-2 rounded-full">
          {toast}
        </div>
      )}
    </div>
  );
}
