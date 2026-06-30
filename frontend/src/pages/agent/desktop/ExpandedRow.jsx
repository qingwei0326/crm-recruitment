import { useEffect, useState } from 'react';
import { StickyNote, Sparkles, Pencil, Check, X, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../../api';
import { stageLabel } from '../../../labels';
import { getApiErrorMessage } from '../../../utils';
import PhoneLink from '../../../components/PhoneLink';
import StudentTimeline from '../../../components/StudentTimeline';
import StageProgress from '../shared/StageProgress';
import QuickStatusButtons from '../shared/QuickStatusButtons';

export default function ExpandedRow({
  student: s, isLocked,
  onDial, onQuickStatus, onUpdateStage, onAddNote, onOpenAi, onScoreChange,
  noteText, onNoteTextChange,
}) {
  const [editingScore, setEditingScore] = useState(false);
  const [scoreVal, setScoreVal] = useState(s.score ?? '');
  const [detail, setDetail] = useState({
    loading: true,
    error: '',
    calls: [],
    notes: [],
    followUps: [],
    visits: [],
    intentTimeline: [],
  });

  useEffect(() => {
    let cancelled = false;
    setDetail((prev) => ({ ...prev, loading: true, error: '' }));
    api
      .get(`/students/${s.id}/detail`)
      .then((res) => {
        if (cancelled) return;
        const data = res.data.data || res.data || {};
        setDetail({
          loading: false,
          error: '',
          calls: data.calls || [],
          notes: data.notes || [],
          followUps: data.follow_ups || [],
          visits: data.visits || [],
          intentTimeline: data.intent_timeline || [],
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setDetail((prev) => ({ ...prev, loading: false, error: getApiErrorMessage(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, [s.id]);

  const saveScore = () => {
    setEditingScore(false);
    const num = scoreVal === '' ? null : Number(scoreVal);
    if (num !== s.score) onScoreChange(s.id, num);
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-800 border-t dark:border-gray-700 px-4 py-3 space-y-3">
      {/* Row 1: Guardian info + Stage */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400">联系人1</span>
          <div className="font-medium text-gray-800 dark:text-gray-200">{s.guardian_name || <span className="text-gray-400 dark:text-gray-500 italic">未填</span>}</div>
          <div className="text-xs">
            <PhoneLink
              value={s.guardian_phone}
              label="拨打联系人1"
              onDial={onDial ? () => onDial('guardian') : undefined}
            />
          </div>
        </div>
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400">联系人2</span>
          <div className="font-medium text-gray-800 dark:text-gray-200">{s.guardian2_name || <span className="text-gray-400 dark:text-gray-500 italic">未填</span>}</div>
          <div className="text-xs">
            <PhoneLink
              value={s.guardian2_phone}
              label="拨打联系人2"
              onDial={onDial ? () => onDial('guardian2') : undefined}
            />
          </div>
        </div>
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400">地域</span>
          <div className="font-medium text-gray-800 dark:text-gray-200">{s.region || <span className="text-gray-400 dark:text-gray-500 italic">未填</span>}</div>
        </div>
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400">成绩</span>
          {editingScore ? (
            <div className="flex items-center gap-1 mt-0.5">
              <input
                type="number"
                value={scoreVal}
                onChange={(e) => setScoreVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveScore(); if (e.key === 'Escape') { setEditingScore(false); setScoreVal(s.score ?? ''); } }}
                className="w-20 px-2 py-1 border dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
              <button onClick={(e) => { e.stopPropagation(); saveScore(); }} className="p-1 text-green-600 hover:bg-green-100 rounded"><Check className="w-3.5 h-3.5" /></button>
              <button onClick={(e) => { e.stopPropagation(); setEditingScore(false); setScoreVal(s.score ?? ''); }} className="p-1 text-gray-400 hover:bg-gray-200 rounded"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div
              className="font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-1 -mx-1 group"
              onClick={(e) => { e.stopPropagation(); setEditingScore(true); }}
            >
              {s.score != null ? s.score : <span className="text-gray-400 dark:text-gray-500 italic">未填</span>}
              <Pencil className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Stage progress */}
      <div>
        <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">当前阶段: {stageLabel(s.stage) || s.stage}</span>
        <StageProgress currentStage={s.stage} onStageClick={onUpdateStage} />
      </div>

      {/* Row 3: Quick status + AI */}
      <div className="flex items-center gap-2 flex-wrap">
        <QuickStatusButtons onStatus={(st) => onQuickStatus(st)} />
        <button
          onClick={onOpenAi}
          disabled={isLocked}
          className="flex items-center justify-center gap-1.5 py-2 px-3 bg-purple-600 text-white rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-3.5 h-3.5" /> AI分析
        </button>
      </div>

      {/* Row 5: Note input */}
      <div className="flex gap-2">
        <input
          value={noteText}
          onChange={(e) => onNoteTextChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddNote()}
          placeholder="写备注，回车发送…"
          className="flex-1 px-3 py-2 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
          onClick={(e) => e.stopPropagation()}
        />
        <button
          onClick={(e) => { e.stopPropagation(); onAddNote(); }}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm"
        >
          <StickyNote className="w-4 h-4" />
        </button>
      </div>

      <div className="border-t dark:border-gray-700 pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">关键时间线</div>
          <div className="text-xs text-gray-400">最近 5 条</div>
        </div>
        {detail.loading ? (
          <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            加载时间线...
          </div>
        ) : detail.error ? (
          <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{detail.error}</span>
          </div>
        ) : (
          <StudentTimeline
            student={s}
            calls={detail.calls}
            notes={detail.notes}
            followUps={detail.followUps}
            visits={detail.visits}
            intentTimeline={detail.intentTimeline}
            limit={5}
            emptyText="暂无跟进记录"
            className="space-y-3"
          />
        )}
      </div>
    </div>
  );
}
