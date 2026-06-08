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
} from 'lucide-react';
import api from '../../api';
import StatusBadge from '../../components/StatusBadge';
import IntentLevelBadge from '../../components/IntentLevelBadge';
import StudentInfoCard from '../../components/StudentInfoCard';
import TimelineItem from '../../components/TimelineItem';
import MobileDialResult from '../../components/MobileDialResult';
import useDialFlow from '../../hooks/useDialFlow';
import { getApiErrorMessage } from '../../utils';

function NoteSheet({ open, onClose, onSubmit, submitting }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-white dark:bg-gray-900 rounded-t-2xl p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">写备注</h3>
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

export default function MobileStudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { dial } = useDialFlow();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [dialing, setDialing] = useState(false);
  const [toast, setToast] = useState('');

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
        <TimelineItem
          key={`note-${d.id}`}
          type="备注"
          icon={StickyNote}
          color={d.source === 'ai' ? 'purple' : 'gray'}
          title="备注"
          content={d.content}
          agentName={d.agent_name}
          timestamp={d.created_at}
          source={d.source}
        />
      );
    }
    if (kind === 'follow_up') {
      return (
        <TimelineItem
          key={`fu-${d.id}`}
          type="回访"
          icon={Calendar}
          color="amber"
          title={`回访计划 · ${d.follow_up_date || ''}`}
          content={d.notes || d.note || d.content || ''}
          agentName={d.agent_name}
          timestamp={d.created_at}
        />
      );
    }
    if (kind === 'visit') {
      return (
        <TimelineItem
          key={`v-${d.id}`}
          type="到访"
          icon={MapPin}
          color="teal"
          title={`${d.visit_type || '到访'} · ${d.visit_date || d.scheduled_date || ''}`}
          content={d.notes || d.note || d.content || ''}
          agentName={d.agent_name}
          timestamp={d.created_at}
        />
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
