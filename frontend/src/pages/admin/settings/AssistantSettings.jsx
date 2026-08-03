import { useEffect, useState } from 'react';
import { Bot, Eye, EyeOff, Loader2, PlugZap, Save, Trash2 } from 'lucide-react';
import api from '../../../api';
import { getApiErrorMessage, unwrapApiResponse } from '../../../utils';

const inputClass = 'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';

function SettingRow({ label, children }) {
  return (
    <div className="grid gap-2 border-b border-gray-200 py-4 last:border-b-0 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start dark:border-gray-700">
      <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</div>
      <div>{children}</div>
    </div>
  );
}

export default function AssistantSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyLast4, setKeyLast4] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [message, setMessage] = useState(null);

  const applyConfig = (config) => {
    setEnabled(Boolean(config.enabled));
    setBaseUrl(config.base_url || 'https://api.openai.com/v1');
    setModel(config.model || '');
    setKeyConfigured(Boolean(config.api_key_configured));
    setKeyLast4(config.api_key_last4 || '');
    setEndpoint(config.endpoint || '');
    setApiKey('');
    setApiKeyDirty(false);
    setClearApiKey(false);
  };

  useEffect(() => {
    let cancelled = false;
    api.get('/admin/assistant/config')
      .then((response) => {
        if (!cancelled) applyConfig(unwrapApiResponse(response));
      })
      .catch((error) => {
        if (!cancelled) setMessage({ type: 'error', text: getApiErrorMessage(error) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const save = async ({ silent = false } = {}) => {
    setSaving(true);
    if (!silent) setMessage(null);
    try {
      const payload = {
        enabled,
        base_url: baseUrl,
        model,
        clear_api_key: clearApiKey,
      };
      if (apiKeyDirty && !clearApiKey) payload.api_key = apiKey;
      const response = await api.put('/admin/assistant/config', payload);
      const config = unwrapApiResponse(response);
      applyConfig(config);
      if (!silent) setMessage({ type: 'success', text: 'AI 助手配置已保存' });
      return true;
    } catch (error) {
      setMessage({ type: 'error', text: getApiErrorMessage(error) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const saved = await save({ silent: true });
      if (!saved) return;
      const response = await api.post('/admin/assistant/config/test');
      const result = unwrapApiResponse(response);
      setMessage({
        type: 'success',
        text: `连接成功，${result.model} 已支持 Tool Calling`,
      });
    } catch (error) {
      setMessage({ type: 'error', text: getApiErrorMessage(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section id="assistant-settings" className="scroll-mt-[110px] rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-2 border-b px-4 py-3.5 dark:border-gray-700">
        <Bot className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">超级管理员 AI 助手</h2>
      </div>
      <div className="p-4 lg:p-6">
        <SettingRow label="启用助手">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((value) => !value)}
            disabled={loading}
            className={`relative h-7 w-12 rounded-full transition ${enabled ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${enabled ? 'left-6' : 'left-1'}`} />
            <span className="sr-only">启用超级管理员 AI 助手</span>
          </button>
        </SettingRow>

        <SettingRow label="Base URL">
          <div className="space-y-1.5">
            <input
              aria-label="AI 助手 Base URL"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              disabled={loading}
              className={inputClass}
              placeholder="https://api.openai.com/v1"
            />
            {endpoint && <div className="break-all font-mono text-xs text-gray-500 dark:text-gray-400">{endpoint}</div>}
          </div>
        </SettingRow>

        <SettingRow label="Model">
          <input
            aria-label="AI 助手模型"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={loading}
            className={inputClass}
            placeholder="模型名称"
          />
        </SettingRow>

        <SettingRow label="API Key">
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="AI 助手 API Key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setApiKeyDirty(true);
                setClearApiKey(false);
              }}
              disabled={loading || clearApiKey}
              className={`${inputClass} min-w-0 flex-1`}
              placeholder={keyConfigured ? `已配置（末四位 ${keyLast4}）` : 'API Key'}
            />
            <button
              type="button"
              title={showKey ? '隐藏 API Key' : '显示 API Key'}
              aria-label={showKey ? '隐藏 AI 助手 API Key' : '显示 AI 助手 API Key'}
              onClick={() => setShowKey((value) => !value)}
              className="flex h-10 w-10 items-center justify-center rounded-lg border text-gray-500 dark:border-gray-600 dark:text-gray-300"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            {keyConfigured && (
              <button
                type="button"
                title="清除 API Key"
                aria-label="清除 AI 助手 API Key"
                onClick={() => {
                  setClearApiKey(true);
                  setApiKey('');
                  setApiKeyDirty(false);
                  setEnabled(false);
                }}
                className={`flex h-10 w-10 items-center justify-center rounded-lg border ${clearApiKey ? 'border-red-500 bg-red-50 text-red-600 dark:bg-red-950/30' : 'text-gray-500 dark:border-gray-600 dark:text-gray-300'}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </SettingRow>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={() => save()}
            disabled={loading || saving || testing}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-medium text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </button>
          <button
            type="button"
            onClick={testConnection}
            disabled={loading || saving || testing}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            测试连接
          </button>
        </div>
        {message?.text && (
          <div className={`mt-3 text-sm ${message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
            {message.text}
          </div>
        )}
      </div>
    </section>
  );
}
