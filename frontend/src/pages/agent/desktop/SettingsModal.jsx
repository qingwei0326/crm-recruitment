import { X } from 'lucide-react';
import api from '../../../api';

export default function SettingsModal({ show, onClose, tokenInput, setTokenInput, tokenSaving, setTokenSaving, tokenMsg, setTokenMsg }) {
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
        } catch {}
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">个人推送设置</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          在 pushplus.plus 注册并获取个人 token。设置后，回访提醒会推送到你自己的微信，而不是管理员。
        </p>
        <input
          type="text"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="留空则使用全局 token"
          className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
          maxLength={64}
        />
        {tokenMsg && (
          <div className="text-xs mt-2 text-blue-600 dark:text-blue-400">{tokenMsg}</div>
        )}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300"
          >
            取消
          </button>
          <button
            onClick={saveToken}
            disabled={tokenSaving}
            className="flex-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50"
          >
            {tokenSaving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
