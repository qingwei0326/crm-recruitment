import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import api from '../api';
import { selectStaleLeads } from '../utils/staleLeads';

function localDateKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dismissKey(user) {
  return `agent-yesterday-uncontacted-dismissed:${user?.id || 'unknown'}:${localDateKey()}`;
}

export default function YesterdayUncontactedBanner({ user, onHandleNow }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const storageKey = useMemo(() => dismissKey(user), [user]);

  useEffect(() => {
    if (!user || user.role !== 'agent') return undefined;
    if (sessionStorage.getItem(storageKey) === '1') return undefined;

    let active = true;
    api
      .get('/tasks/yesterday')
      .then((res) => {
        if (!active || res.data?.code !== 0) return;
        const stale = selectStaleLeads(res.data.data?.stale_unconcat);
        if (stale.length > 0) {
          setItems(stale);
          setOpen(true);
        }
      })
      .catch(() => {
        // A failed reminder must never get in the way of calling.
      });

    return () => {
      active = false;
    };
  }, [storageKey, user]);

  if (!open || items.length === 0) return null;

  const oldestDays = items.reduce((max, item) => Math.max(max, item.days_since_assigned ?? 0), 0);
  const dismiss = () => {
    sessionStorage.setItem(storageKey, '1');
    setOpen(false);
  };
  const handleNow = () => {
    dismiss();
    onHandleNow?.();
  };

  return (
    <div
      role="status"
      className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        有 {items.length} 个线索分配超过 24 小时还没联系
        {oldestDays >= 1 ? `（最久 ${oldestDays} 天）` : ''}
      </span>
      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="min-h-10 rounded-lg px-3 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
        >
          先不管
        </button>
        <button
          type="button"
          onClick={handleNow}
          className="min-h-10 rounded-lg bg-amber-600 px-3 text-sm font-medium text-white hover:bg-amber-700"
        >
          去处理
        </button>
      </span>
    </div>
  );
}
