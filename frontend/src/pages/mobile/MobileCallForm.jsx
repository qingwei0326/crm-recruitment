import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import api from '../../api';

function getApiErrorMessage(error) {
  return (
    error?.response?.data?.detail ||
    error?.response?.data?.msg ||
    error?.message ||
    '提交失败'
  );
}

const intentColors = {
  A: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
  B: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
  C: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
  无: 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600',
};

export default function MobileCallForm() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [studentName, setStudentName] = useState('');
  const [transcript, setTranscript] = useState('');
  const [duration, setDuration] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/students/${id}`)
      .then((r) => {
        if (r.data.code === 0) setStudentName(r.data.data?.name || '');
      })
      .catch(() => {});
  }, [id]);

  const submit = async () => {
    if (!transcript.trim()) {
      setError('请填写通话内容');
      return;
    }
    setError('');
    setSubmitting(true);
    setResult(null);
    try {
      const body = {
        student_id: Number(id),
        transcript: transcript.trim(),
      };
      if (duration && !Number.isNaN(Number(duration))) {
        body.duration_seconds = Number(duration);
      }
      const r = await api.post('/calls/analyze', body);
      if (r.data.code === 0) {
        setResult(r.data.data);
      } else {
        setError(r.data.msg || '分析失败');
      }
    } catch (e) {
      setError(getApiErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <header className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-3 py-3 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-700"
          aria-label="返回"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-gray-500 dark:text-gray-400">填写通话记录</div>
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
            {studentName || `学生 #${id}`}
          </div>
        </div>
      </header>

      <div className="p-3 space-y-3">
        {!result && (
          <>
            <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  通话内容
                </label>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="粘贴通话转录文本，或手动输入对话摘要…"
                  className="w-full h-56 border dark:border-gray-600 rounded-lg p-3 text-base bg-white dark:bg-gray-700 dark:text-gray-100 resize-none outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  通话时长（秒，可选）
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="例如 180"
                  className="w-full px-3 py-3 border dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-sm p-3 rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={submitting || !transcript.trim()}
              className="w-full min-h-[52px] bg-purple-600 text-white rounded-xl text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
              {submitting ? '分析中…' : 'AI 分析并提交'}
            </button>
          </>
        )}

        {result && (
          <div className="space-y-3">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  AI 分析结果
                </span>
              </div>
              <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3">
                <span className="text-xs text-gray-500">意向等级</span>
                <span
                  className={`text-lg font-bold px-3 py-1 rounded-lg border ${
                    intentColors[result.ai_intent] || intentColors['无']
                  }`}
                >
                  {result.ai_intent}级
                </span>
                {result.ai_confidence != null && (
                  <span className="text-xs text-gray-400 ml-auto">
                    置信度 {Math.round(result.ai_confidence * 100)}%
                  </span>
                )}
              </div>
              {result.ai_summary && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">摘要</div>
                  <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                    {result.ai_summary}
                  </div>
                </div>
              )}
              {result.ai_reasons && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">判断依据</div>
                  <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words">
                    {result.ai_reasons}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigate(`/mobile/student/${id}`)}
                className="flex-1 min-h-[48px] bg-blue-600 text-white rounded-xl text-base font-medium active:scale-95"
              >
                查看详情
              </button>
              <button
                type="button"
                onClick={() => navigate('/mobile')}
                className="flex-1 min-h-[48px] border dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-base font-medium active:scale-95"
              >
                返回首页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
