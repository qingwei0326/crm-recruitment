import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  Phone,
  Loader2,
  Sparkles,
  X,
  Pencil,
  Trash2,
  MoreHorizontal,
} from 'lucide-react';
import api from '../../api';
import { completePendingDial } from '../../dialSession';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import StudentInfoCard from '../../components/StudentInfoCard';
import StudentTimeline from '../../components/StudentTimeline';
import { PersonalGroupMembershipEditor } from '../../components/PersonalGroups';
import MobileDialResult from '../../components/MobileDialResult';
import useDialFlow from '../../hooks/useDialFlow';
import { useConfirm } from '../../components/ConfirmDialog';
import { getApiErrorMessage } from '../../utils';
import {
  defaultVisitDate,
  normalizeDateTimeLocal,
  toApiDateTime,
} from '../../utils/dateTime';
import { payloadForOperatorResult } from '../../operatorResultPolicy';
import useLeadOutcomeCatalog from '../../hooks/useLeadOutcomeCatalog';
import { ContentSkeleton, ErrorState } from '../../components/AsyncState';
import {
  detailForOperatorResult,
  displayStatusForOperatorResult,
  STAGES,
  stageLabel,
} from '../../labels';
const VISIT_STATUSES = ['待确认', '已确认', '已完成', '已取消'];

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

const WORKFLOW_EDIT_TABS = [
  { key: 'result', label: '处理结果' },
  { key: 'stage', label: '跟进阶段' },
];

function WorkflowEditSheet({
  open,
  onClose,
  student,
  outcomeResults,
  stageOptions = STAGES,
  activeTab,
  onTabChange,
  onStatusChange,
  onStageChange,
  saving,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        role="dialog"
        aria-label="编辑跟进状态"
        className="w-full bg-white dark:bg-gray-900 rounded-t-2xl p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-4 max-h-[88dvh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
        aria-busy={saving}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              编辑跟进状态
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              选择后立即保存，拨号后的结果仍按通话流程处理
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 p-1 shrink-0"
            aria-label="关闭编辑跟进状态"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1" role="tablist" aria-label="跟进状态编辑项">
          {WORKFLOW_EDIT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`min-h-[42px] rounded-lg px-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-700 dark:text-blue-300'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'result' && (
          <div role="group" aria-label="处理结果" className="space-y-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              联系状态：<StatusBadge status={student?.status} />
              {student?.status_detail && (
                <span className="ml-1">· {student.status_detail}</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {outcomeResults.map((outcome) => (
                <button
                  key={outcome.code}
                  type="button"
                  disabled={saving}
                  onClick={() => onStatusChange(outcome)}
                  className={`min-h-[50px] rounded-xl px-2 text-sm font-medium leading-5 whitespace-normal text-white ${outcome.className} disabled:opacity-60`}
                >
                  {outcome.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'stage' && (
          <div role="group" aria-label="跟进阶段" className="space-y-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              当前阶段：{stageLabel(student?.stage) || '未设置'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {stageOptions.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  disabled={saving || student?.stage === stage}
                  onClick={() => onStageChange(stage)}
                  className={`min-h-[44px] rounded-xl border px-2 text-sm font-medium leading-5 whitespace-normal ${
                    student?.stage === stage
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                  } disabled:opacity-80`}
                >
                  {stageLabel(stage)}
                </button>
              ))}
            </div>
          </div>
        )}

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
  const { results: outcomeResults } = useLeadOutcomeCatalog();

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
  const [workflowEditorOpen, setWorkflowEditorOpen] = useState(false);
  const [workflowEditorTab, setWorkflowEditorTab] = useState('result');
  const [busyDelete, setBusyDelete] = useState(false);
  const [dialing, setDialing] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [toast, setToast] = useState('');
  const detailRequestSeqRef = useRef(0);

  const isAdmin = user?.role === 'admin';
  const canModify = (item) => isAdmin || item?.agent_id === user?.id;
  const mobileOutcomeResults = isAdmin
    ? outcomeResults
    : outcomeResults.filter((outcome) => outcome.code !== 'new_lead');
  const mobileStageOptions = isAdmin
    ? STAGES
    : STAGES.filter((stage) => stage !== '初次联系');

  const loadDetail = useCallback(() => {
    const requestId = ++detailRequestSeqRef.current;
    setLoading(true);
    setError('');
    api
      .get(`/students/${id}/detail`)
      .then((res) => {
        if (requestId === detailRequestSeqRef.current) {
          setData(res.data.data || res.data);
        }
      })
      .catch((e) => {
        if (requestId === detailRequestSeqRef.current) setError(getApiErrorMessage(e));
      })
      .finally(() => {
        if (requestId === detailRequestSeqRef.current) setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    setData(null);
    loadDetail();
  }, [id, loadDetail]);

  const student = data?.student;
  const calls = data?.calls || [];
  const notes = data?.notes || [];
  const followUps = data?.follow_ups || [];
  const visits = data?.visits || [];

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
    if (workflowSaving) return false;
    setWorkflowSaving(true);
    try {
      const r = await request();
      if (r.data.code === 0) {
        onSuccess?.(r.data.data);
        showToast(successMessage);
        return true;
      } else {
        showToast(r.data.msg || '更新失败');
        return false;
      }
    } catch (e) {
      showToast(getApiErrorMessage(e));
      return false;
    } finally {
      setWorkflowSaving(false);
    }
  };

  const handleDial = async (contactKey = 'guardian') => {
    if (!student) return;
    setDialing(true);
    try {
      await dial(student.id, { contactKey, studentName: student.name });
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
        scheduled_date: toApiDateTime(scheduled_date),
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

  const handleUpdateStudentStatus = async (outcome) => {
    if (!student) return false;
    if (outcome.code === 'enrolled') {
      const ok = await confirm({
        title: '确认报名',
        message: '确认将此学生标记为已报名？阶段也会同步更新为已报名。',
        confirmText: '确认报名',
      });
      if (!ok) return false;
    }
    const saved = await runWorkflowUpdate(
      () => api.put(`/students/${student.id}`, payloadForOperatorResult(outcome)),
      '联系状态已更新',
      (updated) => {
        const nextStatus = updated?.status || displayStatusForOperatorResult(outcome);
        const nextDetail = updated?.status_detail ?? detailForOperatorResult(outcome);
        patchStudent({
          status: nextStatus,
          status_detail: nextDetail,
          stage: updated?.stage || (nextStatus === '已报名' ? '已报名' : student.stage),
        });
      },
    );
    if (!saved) return false;
    try {
      await completePendingDial(student.id);
    } catch {
      showToast('状态已保存，通话记录待同步');
    }
    return true;
  };

  const handleUpdateStudentStage = (stage) => {
    if (!student || student.stage === stage) return Promise.resolve(false);
    return runWorkflowUpdate(
      () => api.put(`/students/${student.id}/stage`, { stage }),
      '阶段已更新',
      () => patchStudent({ stage, status: stage === '已报名' ? '已报名' : student.status }),
    );
  };

  const handleToggleNeedHelp = async () => {
    if (workflowSaving) return;
    const next = !student.need_help;
    setWorkflowSaving(true);
    try {
      const r = await api.put(`/students/${student.id}`, { need_help: next });
      if (r.data.code === 0) {
        patchStudent({ need_help: next });
        showToast(next ? '已向主管发起协助' : '已取消协助');
      } else {
        showToast(r.data.msg || '操作失败');
      }
    } catch (e) {
      showToast(getApiErrorMessage(e));
    } finally {
      setWorkflowSaving(false);
    }
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
      <div className="min-h-screen bg-gray-50 px-3 py-5 dark:bg-gray-900">
        <ContentSkeleton rows={4} />
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="min-h-screen flex flex-col items-stretch justify-center gap-3 bg-gray-50 dark:bg-gray-900 px-4">
        <ErrorState
          title={error ? '加载失败' : '未找到该学生'}
          message={error || '该学生可能已被移除或你没有查看权限。'}
          onRetry={loadDetail}
        />
        <button
          onClick={() => navigate(-1)}
          className="mx-auto min-h-[44px] rounded-xl px-4 text-sm font-medium text-gray-600 dark:text-gray-300"
        >
          返回上一页
        </button>
      </div>
    );
  }

  const renderNoteActions = (note) => {
    if (note.source === 'ai' || !canModify(note)) return null;
    return (
      <div className="flex gap-3 mt-1 ml-9 text-xs">
        <button
          type="button"
          onClick={() => setEditNote({ id: note.id, content: note.content })}
          className="inline-flex items-center gap-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
        >
          <Pencil className="w-3 h-3" /> 编辑
        </button>
        <button
          type="button"
          disabled={busyDelete}
          onClick={() => handleDeleteNote(note.id)}
          className="inline-flex items-center gap-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
        >
          <Trash2 className="w-3 h-3" /> 删除
        </button>
      </div>
    );
  };

  const renderFollowUpActions = (followUp) => {
    if (!canModify(followUp)) return null;
    return (
      <div className="flex flex-wrap gap-3 mt-1 ml-9 text-xs">
        {!followUp.is_completed && (
          <button
            type="button"
            disabled={workflowSaving}
            onClick={() => handleCompleteFollowUp(followUp)}
            className="inline-flex items-center gap-1 text-gray-500 hover:text-green-600 dark:hover:text-green-400 disabled:opacity-50"
          >
            完成回访
          </button>
        )}
        <button
          type="button"
          disabled={workflowSaving}
          onClick={() => setEditFollowUp(followUp)}
          className="inline-flex items-center gap-1 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50"
        >
          <Pencil className="w-3 h-3" /> 改期
        </button>
        <button
          type="button"
          disabled={busyDelete}
          onClick={() => handleDeleteFollowUp(followUp.id)}
          className="inline-flex items-center gap-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
        >
          <Trash2 className="w-3 h-3" /> 删除
        </button>
      </div>
    );
  };

  const renderVisitActions = (visit) => {
    if (!canModify(visit)) return null;
    return (
      <div className="flex flex-wrap gap-2 mt-1 ml-9 text-xs">
        {VISIT_STATUSES.filter((status) => status !== visit.status).map((status) => (
          <button
            key={status}
            type="button"
            disabled={workflowSaving}
            onClick={() => handleUpdateVisitStatus(visit, status)}
            className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-gray-500 hover:text-teal-700 hover:border-teal-300 dark:hover:text-teal-300 disabled:opacity-50"
          >
            {status}
          </button>
        ))}
        <button
          type="button"
          disabled={workflowSaving}
          onClick={() => setEditVisit(visit)}
          className="inline-flex items-center gap-1 px-2 py-1 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50"
        >
          <Pencil className="w-3 h-3" /> 改期
        </button>
        <button
          type="button"
          disabled={busyDelete}
          onClick={() => handleDeleteVisit(visit.id)}
          className="inline-flex items-center gap-1 px-2 py-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
        >
          <Trash2 className="w-3 h-3" /> 删除
        </button>
      </div>
    );
  };

  const openWorkflowEditor = (tab = 'result') => {
    setWorkflowEditorTab(tab);
    setWorkflowEditorOpen(true);
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
        </div>
      </header>

      <div className="p-3 space-y-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4">
          <StudentInfoCard
            student={student}
            onDial={handleDial}
            showIntent={false}
            showRegion={false}
            showScore={student.score !== null && student.score !== undefined && student.score !== ''}
            scoreLabel="预估成绩（家长口述）"
            schoolLabel="来源片区"
            compactContacts
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4">
          <PersonalGroupMembershipEditor studentId={student.id} />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                当前跟进
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                拨号后会在结果弹窗里继续处理
              </div>
            </div>
            <button
              type="button"
              onClick={() => openWorkflowEditor()}
              className="shrink-0 inline-flex items-center gap-1.5 min-h-[40px] rounded-lg border border-blue-200 px-3 text-sm font-medium text-blue-600 dark:border-blue-800 dark:text-blue-300 active:scale-95"
            >
              <Pencil className="w-4 h-4" />
              编辑状态
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="min-w-0 rounded-xl bg-gray-50 dark:bg-gray-700/50 p-3">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">联系状态</div>
              <StatusBadge status={student.status} />
              {student.status_detail && (
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate" title={student.status_detail}>
                  {student.status_detail}
                </div>
              )}
            </div>
            <div className="min-w-0 rounded-xl bg-gray-50 dark:bg-gray-700/50 p-3">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">跟进阶段</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-5 break-words">
                {stageLabel(student.stage) || '未设置'}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4">
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            完整时间线
          </div>
          <StudentTimeline
            student={student}
            calls={calls}
            notes={notes}
            followUps={followUps}
            visits={visits}
            renderNoteActions={renderNoteActions}
            renderFollowUpActions={renderFollowUpActions}
            renderVisitActions={renderVisitActions}
          />
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 flex gap-2 border-t border-slate-200 bg-white px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] dark:border-slate-700 dark:bg-slate-800">
        <button
          type="button"
          onClick={handleDial}
          disabled={dialing}
          className="flex-1 min-h-[52px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-60 active:scale-95"
        >
          {dialing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Phone className="w-5 h-5" />}
          开始拨打
        </button>
        <button
          type="button"
          onClick={() => setMoreActionsOpen(true)}
          className="inline-flex min-h-[52px] min-w-[72px] items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 active:scale-95 dark:border-slate-600 dark:text-slate-200"
          aria-label="更多操作"
        >
          <MoreHorizontal className="h-5 w-5" />
          更多
        </button>
      </div>

      {moreActionsOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setMoreActionsOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="学生更多操作"
            className="w-full rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-2xl dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-slate-900 dark:text-slate-100">更多操作</div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">不常用操作集中在这里</div>
              </div>
              <button type="button" onClick={() => setMoreActionsOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400" aria-label="关闭更多操作">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setMoreActionsOpen(false); setNoteOpen(true); }} className="min-h-[72px] rounded-xl bg-slate-50 px-2 text-sm font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                写备注
              </button>
              <button type="button" onClick={() => { setMoreActionsOpen(false); setVisitOpen(true); }} className="min-h-[72px] rounded-xl bg-teal-50 px-2 text-sm font-medium text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                登记到访
              </button>
              <button type="button" onClick={() => { setMoreActionsOpen(false); openWorkflowEditor(); }} className="min-h-[72px] rounded-xl bg-blue-50 px-2 text-sm font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                编辑状态
              </button>
              <button type="button" onClick={() => { setMoreActionsOpen(false); handleToggleNeedHelp(); }} className={`min-h-[72px] rounded-xl px-2 text-sm font-medium ${student?.need_help ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' : 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300'}`}>
                {student?.need_help ? '取消协助' : '需要协助'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      <WorkflowEditSheet
        open={workflowEditorOpen}
        onClose={() => setWorkflowEditorOpen(false)}
        student={student}
        outcomeResults={mobileOutcomeResults}
        stageOptions={mobileStageOptions}
        activeTab={workflowEditorTab}
        onTabChange={setWorkflowEditorTab}
        onStatusChange={handleUpdateStudentStatus}
        onStageChange={handleUpdateStudentStage}
        saving={workflowSaving}
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
