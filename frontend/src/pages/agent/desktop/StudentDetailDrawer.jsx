import { useEffect, useState } from 'react';
import { AlertTriangle, CheckSquare, History, Home, Loader2, MapPin, Sparkles, X } from 'lucide-react';
import api from '../../../api';
import HomeVisitForm from '../../../components/admissions/HomeVisitForm';
import CampusVisitForm from '../../../components/admissions/CampusVisitForm';
import StudentInfoCard from '../../../components/StudentInfoCard';
import StudentTimeline from '../../../components/StudentTimeline';
import { PersonalGroupMembershipEditor } from '../../../components/PersonalGroups';
import QuickStatusButtons from '../shared/QuickStatusButtons';

const INTENT_LEVELS = ['A', 'B', 'C', '无'];

function intentButtonClass(active, level) {
  if (!active) {
    return 'bg-white border dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700';
  }
  if (level === 'A') return 'bg-red-100 text-red-700 ring-2 ring-red-300 dark:bg-red-900/40 dark:text-red-300';
  if (level === 'B') return 'bg-amber-100 text-amber-700 ring-2 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-300';
  if (level === 'C') return 'bg-gray-200 text-gray-700 ring-2 ring-gray-300 dark:bg-gray-600 dark:text-gray-200';
  return 'bg-gray-100 text-gray-500 ring-2 ring-gray-200 dark:bg-gray-700 dark:text-gray-400';
}

export default function StudentDetailDrawer({
  open,
  student,
  loading,
  error,
  calls = [],
  notes = [],
  followUps = [],
  visits = [],
  intentTimeline = [],
  admissionsTimeline = [],
  hasAnalysis,
  onClose,
  onRetry,
  onUpdateField,
  onDial,
  onStatusUpdate,
  statusLocked = false,
  onStageSynced,
  onRefreshDetail,
}) {
  const [activeForm, setActiveForm] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const submitHomeVisit = async (payload) => {
    setSubmitting(true);
    try {
      await api.post('/admissions/home-visits', payload);
      setActiveForm(null);
      onStageSynced?.(student.id, '待家访');
      onRefreshDetail?.();
    } finally {
      setSubmitting(false);
    }
  };

  const submitCampusVisit = async (payload) => {
    setSubmitting(true);
    try {
      await api.post('/admissions/campus-visits', payload);
      setActiveForm(null);
      onStageSynced?.(student.id, '到校参观已安排');
      onRefreshDetail?.();
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !student) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-gray-950/40 backdrop-blur-[1px]" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${student.name}的学生详情`}
        className="flex h-full w-full max-w-3xl flex-col bg-gray-50 shadow-2xl dark:bg-gray-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {student.name}
            </h3>
            <div className="text-xs text-gray-400">档案与跟进记录</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-label="关闭学生详情"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 scroll-thin">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              加载学生详情...
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={onRetry} className="font-medium">重试</button>
            </div>
          )}

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <StudentInfoCard
              student={student}
              onDial={onDial ? (contactKey) => onDial(contactKey, student.id) : undefined}
            />
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <PersonalGroupMembershipEditor studentId={student.id} />
          </section>

          {onStatusUpdate && (
            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                  <CheckSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  话务结果
                </div>
                {statusLocked && (
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">当前通话待完成</span>
                )}
              </div>
              <QuickStatusButtons
                disabled={statusLocked}
                onStatus={(outcome) => onStatusUpdate(student.id, outcome)}
              />
            </section>
          )}

          <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  招生推进
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  提交家访申请或预约家长到校
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveForm(activeForm === 'home' ? null : 'home')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white"
                >
                  <Home className="w-3.5 h-3.5" />
                  申请家访
                </button>
                <button
                  type="button"
                  onClick={() => setActiveForm(activeForm === 'campus' ? null : 'campus')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  预约到校
                </button>
              </div>
            </div>
            {activeForm === 'home' && (
              <HomeVisitForm
                student={student}
                submitting={submitting}
                onSubmit={submitHomeVisit}
                onCancel={() => setActiveForm(null)}
              />
            )}
            {activeForm === 'campus' && (
              <CampusVisitForm
                student={student}
                submitting={submitting}
                onSubmit={submitCampusVisit}
                onCancel={() => setActiveForm(null)}
              />
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-2 text-xs font-medium text-gray-500">意向等级</div>
            <div className="flex flex-wrap gap-2">
              {INTENT_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => onUpdateField('intent_level', level)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${intentButtonClass(student.intent_level === level, level)}`}
                >
                  {level === '无' ? '无' : `${level}级`}
                </button>
              ))}
            </div>
          </section>

          <section className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <span className="text-xs text-gray-500">AI分析状态</span>
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${
                hasAnalysis
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              }`}
            >
              {hasAnalysis && <Sparkles className="w-3 h-3" />}
              {hasAnalysis ? 'AI分析已完成' : '暂未分析'}
            </span>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
              <History className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              完整时间线
            </div>
            <StudentTimeline
              student={student}
              calls={calls}
              notes={notes}
              followUps={followUps}
              visits={visits}
              intentTimeline={intentTimeline}
              admissionsTimeline={admissionsTimeline}
            />
          </section>
        </div>
      </aside>
    </div>
  );
}
