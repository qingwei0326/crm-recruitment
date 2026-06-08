import { useState, useRef } from 'react';
import { X, Loader2, Sparkles } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import api from '../../api';

export default function AiPanel({ activeStudent, onClose, onStatusUpdate }) {
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
    </div>
  );
}
