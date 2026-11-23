import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const ConfirmContext = createContext(null);
const PromptContext = createContext(null);

/**
 * Promise 式确认弹窗，替代 window.confirm。
 * 用法：
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title, message, confirmText, tone });
 *   if (!ok) return;
 * tone: 'danger'（红，删除/回收）| 'default'（蓝）
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { title, message, confirmText, cancelText, tone }
  const resolverRef = useRef(null);

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({
        title: opts.title || '确认操作',
        message: opts.message || '',
        confirmText: opts.confirmText || '确认',
        cancelText: opts.cancelText || '取消',
        tone: opts.tone || 'default',
      });
    });
  }, []);

  const close = useCallback((result) => {
    setState(null);
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!state) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, close]);

  const confirmBtnCls =
    state?.tone === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-blue-600 hover:bg-blue-700';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[1px]"
          onClick={() => close(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="w-full max-w-sm rounded-panel border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900 animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-dialog-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {state.title}
            </h3>
            {state.message && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                {state.message}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="min-h-[40px] rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 active:scale-95 dark:border-slate-700 dark:text-slate-200"
              >
                {state.cancelText}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`min-h-[40px] rounded-lg px-4 text-sm font-medium text-white active:scale-95 ${confirmBtnCls}`}
              >
                {state.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

/**
 * Promise 式输入弹窗，替代 window.prompt。
 * 用法：
 *   const prompt = usePrompt();
 *   const value = await prompt({ title, message, placeholder });
 *   if (!value) return;
 */
export function PromptProvider({ children }) {
  const [state, setState] = useState(null);
  const [value, setValue] = useState('');
  const resolverRef = useRef(null);

  const prompt = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setValue(opts.defaultValue || '');
      setState({
        title: opts.title || '请输入',
        message: opts.message || '',
        placeholder: opts.placeholder || '',
        confirmText: opts.confirmText || '确认',
        cancelText: opts.cancelText || '取消',
      });
    });
  }, []);

  const close = useCallback((result) => {
    setState(null);
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  const submit = useCallback((e) => {
    e.preventDefault();
    close(value.trim());
  }, [close, value]);

  useEffect(() => {
    if (!state) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') close(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, close]);

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[1px]"
          onClick={() => close(null)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-dialog-title"
            className="w-full max-w-sm rounded-panel border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900 animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
          >
            <h3 id="prompt-dialog-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {state.title}
            </h3>
            {state.message && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                {state.message}
              </p>
            )}
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={state.placeholder}
              autoFocus
              className="mt-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close(null)}
                className="min-h-[40px] rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 active:scale-95 dark:border-slate-700 dark:text-slate-200"
              >
                {state.cancelText}
              </button>
              <button
                type="submit"
                className="min-h-[40px] rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 active:scale-95"
              >
                {state.confirmText}
              </button>
            </div>
          </form>
        </div>
      )}
    </PromptContext.Provider>
  );
}

export const usePrompt = () => useContext(PromptContext);
