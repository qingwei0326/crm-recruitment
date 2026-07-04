import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import api from '../api';
import { formatDateTime } from '../utils';

function localDateKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function promptKey(user) {
  return `agent-yesterday-uncontacted-dismissed:${user?.id || 'unknown'}:${localDateKey()}`;
}

export default function YesterdayUncontactedPrompt({ user, onHandleNow }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const storageKey = useMemo(() => promptKey(user), [user]);

  useEffect(() => {
    if (!user || user.role !== 'agent') return undefined;
    if (sessionStorage.getItem(storageKey) === '1') return undefined;

    let active = true;
    api
      .get('/tasks/yesterday')
      .then((res) => {
        if (!active || res.data?.code !== 0) return;
        const stale = res.data.data?.stale_unconcat || [];
        if (stale.length > 0) {
          setItems(stale);
          setOpen(true);
        }
      })
      .catch(() => {
        // Reminder failure must not block the operator from working.
      });

    return () => {
      active = false;
    };
  }, [storageKey, user]);

  if (!open || items.length === 0) return null;

  const previewItems = items.slice(0, 5);
  const closeForSession = () => {
    sessionStorage.setItem(storageKey, '1');
    setOpen(false);
  };

  const handleNow = () => {
    closeForSession();
    onHandleNow?.();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="yesterday-uncontacted-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-800"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="yesterday-uncontacted-title"
              className="text-base font-semibold text-gray-900 dark:text-gray-100"
            >
              昨日遗留未联系 {items.length} 个
            </h3>
            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
              先把昨天及更早分配但仍未联系的学生处理掉，避免线索继续过期。
            </p>
          </div>
        </div>

        <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
          {previewItems.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {item.name}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                    {item.school_name || '未知学校'}
                    {item.region ? ` · ${item.region}` : ''}
                  </div>
                </div>
                {item.days_since_assigned != null && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {item.days_since_assigned}天
                  </span>
                )}
              </div>
              {item.assigned_at && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                  <CalendarClock className="h-3 w-3" />
                  分配：{formatDateTime(item.assigned_at)}
                </div>
              )}
            </div>
          ))}
          {items.length > previewItems.length && (
            <div className="text-center text-xs text-gray-400">
              还有 {items.length - previewItems.length} 个未显示
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={closeForSession}
            className="min-h-10 rounded-lg border px-4 text-sm font-medium text-gray-700 active:scale-95 dark:border-gray-600 dark:text-gray-200"
          >
            稍后
          </button>
          <button
            type="button"
            onClick={handleNow}
            className="min-h-10 rounded-lg bg-amber-600 px-4 text-sm font-medium text-white active:scale-95 hover:bg-amber-700"
          >
            先处理
          </button>
        </div>
      </div>
    </div>
  );
}
