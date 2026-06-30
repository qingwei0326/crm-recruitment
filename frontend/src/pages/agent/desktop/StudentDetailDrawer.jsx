import { AlertTriangle, Loader2, Sparkles, X } from 'lucide-react';
import StudentInfoCard from '../../../components/StudentInfoCard';
import StudentTimeline from '../../../components/StudentTimeline';

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
  hasAnalysis,
  onClose,
  onRetry,
  onUpdateField,
  onDial,
}) {
  if (!open || !student) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="w-full max-w-2xl bg-white dark:bg-gray-800 h-full shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {student.name}
            </h3>
            <div className="text-xs text-gray-400">学生详情</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-9 h-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="关闭学生详情"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
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

          <StudentInfoCard
            student={student}
            onDial={onDial ? (contactKey) => onDial(contactKey, student.id) : undefined}
          />

          <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-2">意向等级（手动评级）</div>
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
          </div>

          <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 flex items-center justify-between">
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
          </div>

          <section className="border-t dark:border-gray-700 pt-4">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
              完整时间线
            </div>
            <StudentTimeline
              student={student}
              calls={calls}
              notes={notes}
              followUps={followUps}
              visits={visits}
              intentTimeline={intentTimeline}
            />
          </section>
        </div>
      </aside>
    </div>
  );
}
