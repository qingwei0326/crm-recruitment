import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import api from '../api';
import { getApiErrorMessage, unwrapApiResponse } from '../utils';
import StatusBadge from './StatusBadge';
import { ContentSkeleton, EmptyState, ErrorState } from './AsyncState';

const DEBOUNCE_MS = 300;

// Finds any student assigned to the agent, whatever list or status they are in. The call
// and pending lists only show students still waiting for action, so a student marked
// invalid (or enrolled) by mistake used to be impossible to find again.
export default function AgentStudentSearch({ open, onClose, onPick }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const keyword = query.trim();

  useEffect(() => {
    if (!open) {
      requestRef.current += 1;
      setQuery('');
      setResult(null);
      setError('');
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const requestId = ++requestRef.current;
    if (!keyword) {
      setResult(null);
      setError('');
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get('/tasks/search', { params: { q: keyword } });
        const data = unwrapApiResponse(response);
        if (requestRef.current !== requestId) return;
        setResult(data);
        setError('');
      } catch (e) {
        if (requestRef.current !== requestId) return;
        setError(getApiErrorMessage(e));
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, keyword]);

  if (!open) return null;

  const list = result?.list || [];

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label="搜索我的学生"
        className="flex max-h-[90vh] min-h-[60vh] w-full flex-col rounded-t-panel bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">搜索我的学生</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center text-gray-400"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="学生姓名、家长姓名或电话（后 4 位也行）"
            aria-label="搜索关键词"
            autoFocus
            className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div className="mt-3 flex-1 overflow-y-auto">
          {error ? (
            <ErrorState bare message={error} onRetry={() => setQuery((q) => `${q} `.trimEnd())} />
          ) : !keyword ? (
            <p className="px-2 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              包括已标无效、已报名的学生。标错了，搜出来点开就能重新标记。
            </p>
          ) : loading && !result ? (
            <ContentSkeleton rows={3} compact />
          ) : list.length === 0 ? (
            <EmptyState
              bare
              title="没有找到"
              description={`没有找到「${keyword}」。只能搜到分配给你的学生。`}
            />
          ) : (
            <ul className="space-y-2">
              {list.map((student) => (
                <li key={student.id}>
                  <button
                    type="button"
                    onClick={() => onPick(student.id)}
                    className="min-h-[56px] w-full rounded-panel border border-gray-200 px-3 py-2 text-left active:bg-gray-50 dark:border-gray-700 dark:active:bg-gray-800"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {student.name}
                      </span>
                      <StatusBadge status={student.status} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                      {[student.region, student.school_name, student.guardian_phone]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div
                      className={`mt-0.5 text-xs ${
                        student.in_my_lists
                          ? 'text-gray-500 dark:text-gray-400'
                          : 'text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {student.in_my_lists
                        ? `在「${student.queue_label}」里`
                        : `${student.queue_label}，不在你的列表里`}
                    </div>
                  </button>
                </li>
              ))}
              {result?.total > list.length && (
                <li className="py-2 text-center text-xs text-gray-500 dark:text-gray-400">
                  共 {result.total} 个，只显示前 {list.length} 个，请输入更多字
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
