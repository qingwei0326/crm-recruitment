import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let _id = 0;

const TOAST_CONFIG = {
  info: {
    icon: Info,
    className: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/80 dark:bg-blue-950/90 dark:text-blue-100',
    iconClassName: 'text-blue-600 dark:text-blue-300',
  },
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/80 dark:bg-emerald-950/90 dark:text-emerald-100',
    iconClassName: 'text-emerald-600 dark:text-emerald-300',
  },
  error: {
    icon: AlertCircle,
    className: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/80 dark:bg-red-950/95 dark:text-red-100',
    iconClassName: 'text-red-600 dark:text-red-300',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/80 dark:bg-amber-950/95 dark:text-amber-100',
    iconClassName: 'text-amber-600 dark:text-amber-300',
  },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++_id;
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
    if (duration > 0) {
      const timer = window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      }, duration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useMemo(() => ({
    info: (msg) => addToast(msg, 'info'),
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error', 6000),
    warning: (msg) => addToast(msg, 'warning', 5000),
  }), [addToast]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[100] flex flex-col gap-2 sm:left-auto sm:right-4 sm:top-4 sm:w-full sm:max-w-sm"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((toastItem) => {
          const config = TOAST_CONFIG[toastItem.type] || TOAST_CONFIG.info;
          const Icon = config.icon;
          const urgent = toastItem.type === 'error' || toastItem.type === 'warning';
          return (
            <div
              key={toastItem.id}
              role={urgent ? 'alert' : 'status'}
              className={`${config.className} pointer-events-auto flex min-h-12 items-start gap-3 rounded-panel border px-3.5 py-3 shadow-xl backdrop-blur animate-slide-in`}
            >
              <Icon className={`${config.iconClassName} mt-0.5 h-5 w-5 shrink-0`} aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words text-sm font-medium leading-5">
                {toastItem.message}
              </span>
              <button
                type="button"
                onClick={() => removeToast(toastItem.id)}
                className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-current opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                aria-label="关闭提示"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
