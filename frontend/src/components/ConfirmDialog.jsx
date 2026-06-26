import { createContext, useContext, useState, useCallback, useRef } from 'react';

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

  const confirmBtnCls =
    state?.tone === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-blue-600 hover:bg-blue-700';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => close(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-800 shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {state.title}
            </h3>
            {state.message && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                {state.message}
              </p>
            )}
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => close(false)}
                className="px-4 min-h-[40px] rounded-lg text-sm font-medium border dark:border-gray-600 text-gray-700 dark:text-gray-200 active:scale-95"
              >
                {state.cancelText}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`px-4 min-h-[40px] rounded-lg text-sm font-medium text-white active:scale-95 ${confirmBtnCls}`}
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

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => close(null)}
        >
          <form
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-800 shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
          >
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {state.title}
            </h3>
            {state.message && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                {state.message}
              </p>
            )}
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={state.placeholder}
              autoFocus
              className="mt-4 w-full px-3 py-2 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
            />
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => close(null)}
                className="px-4 min-h-[40px] rounded-lg text-sm font-medium border dark:border-gray-600 text-gray-700 dark:text-gray-200 active:scale-95"
              >
                {state.cancelText}
              </button>
              <button
                type="submit"
                className="px-4 min-h-[40px] rounded-lg text-sm font-medium text-white active:scale-95 bg-blue-600 hover:bg-blue-700"
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
