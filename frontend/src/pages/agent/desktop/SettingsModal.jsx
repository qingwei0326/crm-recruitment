import { useEffect } from 'react';
import { X } from 'lucide-react';
import api from '../../../api';

export default function SettingsModal({ show, onClose, tokenInput, setTokenInput, tokenSaving, setTokenSaving, tokenMsg, setTokenMsg }) {
  useEffect(() => {
    if (!show) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose]);

  if (!show) return null;

  const saveToken = async () => {
    setTokenSaving(true);
    setTokenMsg('');
    try {
      const res = await api.put('/auth/me/pushplus-token', { pushplus_token: tokenInput.trim() });
      if (res.data.code === 0) {
        setTokenMsg('保存成功，下次推送将使用此 token');
        try {
          const saved = JSON.parse(localStorage.getItem('crm_user') || '{}');
          saved.pushplus_token = tokenInput.trim();
          localStorage.setItem('crm_user', JSON.stringify(saved));
        } catch {
          // The token is already persisted remotely; stale local cache is non-fatal.
        }
      } else {
        setTokenMsg(res.data.msg || '保存失败');
      }
    } catch (e) {
      setTokenMsg(e?.response?.data?.msg || '保存失败');
    } finally {
      setTokenSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="w-full max-w-md rounded-panel border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900 animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 id="settings-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">个人推送设置</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭推送设置"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          在 pushplus.plus 注册并获取个人 token。设置后，回访提醒会推送到你自己的微信，而不是管理员。
        </p>
        <input
          type="text"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="留空则使用全局 token"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          maxLength={64}
        />
        {tokenMsg && (
          <div className="mt-2 text-xs text-blue-600 dark:text-blue-400">{tokenMsg}</div>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            取消
          </button>
          <button
            type="button"
            onClick={saveToken}
            disabled={tokenSaving}
            className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {tokenSaving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
