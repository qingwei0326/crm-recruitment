import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';

const STORAGE_PREFIX = 'crm_admin_dashboard_cards:v1';
const SIGNATURE_SEPARATOR = '\u0001';

function getStorageKey(scope, userKey) {
  const safeUserKey = encodeURIComponent(String(userKey || 'default'));
  return `${STORAGE_PREFIX}:${safeUserKey}:${scope || 'default'}`;
}

function splitSignature(signature) {
  return signature ? signature.split(SIGNATURE_SEPARATOR) : [];
}

function readHiddenKeys(storageKey, cardKeys, fallback) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.filter((key) => cardKeys.includes(key)))];
    }
    if (Array.isArray(parsed?.hiddenKeys)) {
      return [...new Set(parsed.hiddenKeys.filter((key) => cardKeys.includes(key)))];
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function useDashboardCardPreferences({ cards = [], scope = 'default', userKey = 'default' }) {
  const storageKey = useMemo(() => getStorageKey(scope, userKey), [scope, userKey]);
  const cardKeySignature = cards.map((card) => card.key).join(SIGNATURE_SEPARATOR);
  const defaultHiddenSignature = cards
    .filter((card) => card.defaultVisible === false)
    .map((card) => card.key)
    .join(SIGNATURE_SEPARATOR);
  const fallbackHiddenKeys = splitSignature(defaultHiddenSignature);
  const [state, setState] = useState(() => ({
    storageKey,
    hiddenKeys: readHiddenKeys(storageKey, splitSignature(cardKeySignature), fallbackHiddenKeys),
  }));

  useEffect(() => {
    setState({
      storageKey,
      hiddenKeys: readHiddenKeys(
        storageKey,
        splitSignature(cardKeySignature),
        splitSignature(defaultHiddenSignature),
      ),
    });
  }, [cardKeySignature, defaultHiddenSignature, storageKey]);

  useEffect(() => {
    if (state.storageKey !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ hiddenKeys: state.hiddenKeys }));
    } catch {
      // Preferences are an enhancement; a restricted browser must not break the dashboard.
    }
  }, [state, storageKey]);

  const hiddenKeys = state.storageKey === storageKey ? state.hiddenKeys : fallbackHiddenKeys;
  const visibleCards = useMemo(
    () => cards.filter((card) => !hiddenKeys.includes(card.key)),
    [cards, hiddenKeys],
  );

  const toggleCard = (key) => {
    setState((current) => {
      const currentHiddenKeys = current.storageKey === storageKey ? current.hiddenKeys : fallbackHiddenKeys;
      const hidden = currentHiddenKeys.includes(key);
      return {
        storageKey,
        hiddenKeys: hidden
          ? currentHiddenKeys.filter((item) => item !== key)
          : [...currentHiddenKeys, key],
      };
    });
  };

  const resetCards = () => {
    setState({ storageKey, hiddenKeys: fallbackHiddenKeys });
  };

  return { hiddenKeys, visibleCards, toggleCard, resetCards };
}

export function DashboardCardPicker({
  cards = [],
  hiddenKeys = [],
  onToggle,
  onReset,
  label = '更多',
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const hiddenSet = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);
  const selectedCount = cards.filter((card) => !hiddenSet.has(card.key)).length;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-700 dark:hover:text-blue-300"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {label}
        <span className="text-[10px] text-slate-400 dark:text-slate-500">{selectedCount}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="选择展示卡片"
          className="absolute right-0 top-10 z-30 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <div>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100">选择展示卡片</div>
              <div className="mt-0.5 text-[10px] leading-4 text-slate-400 dark:text-slate-500">无数据时仍会自动隐藏</div>
            </div>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              <RotateCcw className="h-3 w-3" />
              恢复默认
            </button>
          </div>
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {cards.map((card) => {
              const checked = !hiddenSet.has(card.key);
              const unavailable = card.hasData === false && !card.loading && !card.error;
              return (
                <label
                  key={card.key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(card.key)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{card.label}</span>
                  {unavailable && <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">无数据</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function hasDashboardCardData(card) {
  if (card?.loading || card?.error) return true;
  if (card?.hideWhenEmpty === false) return true;
  if (typeof card?.hasData === 'boolean') return card.hasData;
  return Number(card?.value || 0) > 0;
}
