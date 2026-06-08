import { useState } from 'react';
import { StickyNote, Sparkles, Pencil, Check, X } from 'lucide-react';
import api from '../../../api';
import { statusLabel } from '../../../labels';
import { STATUS_STYLE } from '../agentWorkUtils';
import StageProgress from '../shared/StageProgress';
import QuickStatusButtons from '../shared/QuickStatusButtons';

export default function ExpandedRow({
  student: s, isLocked,
  onQuickStatus, onUpdateStage, onAddNote, onOpenAi, onScoreChange,
  noteText, onNoteTextChange,
}) {
  const [editingScore, setEditingScore] = useState(false);
  const [scoreVal, setScoreVal] = useState(s.score ?? '');

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
          <div className="font-mono text-xs">{s.guardian_phone
            ? <span className="text-green-600 dark:text-green-400">{s.guardian_phone}</span>
            : <span className="text-gray-400 dark:text-gray-500 italic">未填</span>}</div>
        </div>
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400">联系人2</span>
          <div className="font-medium text-gray-800 dark:text-gray-200">{s.guardian2_name || <span className="text-gray-400 dark:text-gray-500 italic">未填</span>}</div>
          <div className="font-mono text-xs">{s.guardian2_phone
            ? <span className="text-green-600 dark:text-green-400">{s.guardian2_phone}</span>
            : <span className="text-gray-400 dark:text-gray-500 italic">未填</span>}</div>
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
        <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">当前阶段: {statusLabel(s.stage) || s.stage}</span>
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
    </div>
  );
}
