import { useEffect, useState } from 'react';
import { Download, Eye, EyeOff, Menu, Phone, RefreshCw, Save, Sparkles } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';

function SettingRow({ label, children }) {
  return (
    <div className="grid gap-2 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start py-4 border-b border-gray-200 dark:border-gray-700">
      <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function RowMessage({ state }) {
  if (!state?.text) return null;
  return (
    <div className={`mt-2 text-sm ${state.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
      {state.text}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100';

export default function SystemSettings() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState('');
  const [tokenDirty, setTokenDirty] = useState(false);
  const [showDsKey, setShowDsKey] = useState(false);
  const [dsKey, setDsKey] = useState('');
  const [dsKeyDirty, setDsKeyDirty] = useState(false);
  const [aiMessage, setAiMessage] = useState(null);
  const [savingAi, setSavingAi] = useState(false);
  // AI 引擎可切换：deepseek（默认）/ mimo / custom
  const [aiProvider, setAiProvider] = useState('deepseek');
  const [showMimoKey, setShowMimoKey] = useState(false);
  const [mimoKey, setMimoKey] = useState('');
  const [mimoKeyDirty, setMimoKeyDirty] = useState(false);
  const [mimoBase, setMimoBase] = useState('https://token-plan-sgp.xiaomimimo.com/v1');
  const [mimoModel, setMimoModel] = useState('mimo-v2.5-pro');
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [customKey, setCustomKey] = useState('');
  const [customKeyDirty, setCustomKeyDirty] = useState(false);
  const [customBase, setCustomBase] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [staleDays, setStaleDays] = useState('3');
  const [tokenMessage, setTokenMessage] = useState(null);
  const [daysMessage, setDaysMessage] = useState(null);
  const [savingToken, setSavingToken] = useState(false);
  const [savingDays, setSavingDays] = useState(false);
  const [dialWindowStart, setDialWindowStart] = useState('08:00');
  const [dialWindowEnd, setDialWindowEnd] = useState('21:00');
  const [dialMaxPer24h, setDialMaxPer24h] = useState('3');
  const [dialMessage, setDialMessage] = useState(null);
  const [savingDial, setSavingDial] = useState(false);
  const [backups, setBackups] = useState([]);
  const [backupMessage, setBackupMessage] = useState(null);
  const [backingUp, setBackingUp] = useState(false);

  const closeSidebar = () => setSidebarOpen(false);

  const loadBackups = async () => {
    try {
      const res = await api.get('/admin/backups');
      setBackups(res.data.data || []);
    } catch {
      // 静默失败，下次刷新自然重试
    }
  };

  const triggerBackup = async () => {
    setBackupMessage(null);
    setBackingUp(true);
    try {
      await api.post('/admin/backups');
      setBackupMessage({ type: 'success', text: '备份已生成' });
      await loadBackups();
    } catch (err) {
      setBackupMessage({ type: 'error', text: err.response?.data?.msg || '备份失败' });
    } finally {
      setBackingUp(false);
    }
  };

  const formatBytes = (n) => {
    if (!n && n !== 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/config');
      const cfg = res.data.data || {};
      setToken(cfg.pushplus_token || '');
      setTokenDirty(false);
      setDsKey(cfg.deepseek_api_key || '');
      setDsKeyDirty(false);
      setAiProvider(cfg.ai_provider || 'deepseek');
      setMimoKey(cfg.mimo_api_key || '');
      setMimoKeyDirty(false);
      setMimoBase(cfg.mimo_base || 'https://token-plan-sgp.xiaomimimo.com/v1');
      setMimoModel(cfg.mimo_model || 'mimo-v2.5-pro');
      setCustomKey(cfg.ai_custom_api_key || '');
      setCustomKeyDirty(false);
      setCustomBase(cfg.ai_custom_base || '');
      setCustomModel(cfg.ai_custom_model || '');
      setStaleDays(cfg.stale_days || '3');
      setDialWindowStart(cfg.dial_window_start || '08:00');
      setDialWindowEnd(cfg.dial_window_end || '21:00');
      setDialMaxPer24h(cfg.dial_max_per_24h || '3');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig().catch(() => setLoading(false));
    loadBackups();
  }, []);

  const saveToken = async () => {
    setTokenMessage(null);
    if (!tokenDirty) {
      setTokenMessage({ type: 'success', text: '未修改' });
      return;
    }
    setSavingToken(true);
    try {
      const res = await api.put('/admin/config', { key: 'pushplus_token', value: token });
      setToken(res.data.data?.value ?? token);
      setTokenDirty(false);
      setTokenMessage({ type: 'success', text: '已保存' });
    } catch (err) {
      setTokenMessage({ type: 'error', text: err.response?.data?.msg || '保存失败' });
    } finally {
      setSavingToken(false);
    }
  };

  const saveAi = async () => {
    setAiMessage(null);
    setSavingAi(true);
    try {
      const puts = [api.put('/admin/config', { key: 'ai_provider', value: aiProvider })];
      // key 字段回显是掩码（****xxxx），只在用户改过时才回写，避免把掩码存进去
      if (aiProvider === 'deepseek' && dsKeyDirty) {
        puts.push(api.put('/admin/config', { key: 'deepseek_api_key', value: dsKey }));
      }
      if (aiProvider === 'mimo') {
        if (mimoKeyDirty) {
          puts.push(api.put('/admin/config', { key: 'mimo_api_key', value: mimoKey }));
        }
        puts.push(api.put('/admin/config', { key: 'mimo_base', value: mimoBase }));
        puts.push(api.put('/admin/config', { key: 'mimo_model', value: mimoModel }));
      }
      if (aiProvider === 'custom') {
        if (customKeyDirty) {
          puts.push(api.put('/admin/config', { key: 'ai_custom_api_key', value: customKey }));
        }
        puts.push(api.put('/admin/config', { key: 'ai_custom_base', value: customBase }));
        puts.push(api.put('/admin/config', { key: 'ai_custom_model', value: customModel }));
      }
      await Promise.all(puts);
      setDsKeyDirty(false);
      setMimoKeyDirty(false);
      setCustomKeyDirty(false);
      setAiMessage({ type: 'success', text: '已保存（下次通话分析生效，无需重启）' });
    } catch (err) {
      setAiMessage({ type: 'error', text: err.response?.data?.msg || '保存失败' });
    } finally {
      setSavingAi(false);
    }
  };

  const saveDays = async () => {
    setDaysMessage(null);
    setSavingDays(true);
    try {
      const res = await api.put('/admin/config', { key: 'stale_days', value: String(staleDays) });
      setStaleDays(res.data.data?.value ?? String(staleDays));
      setDaysMessage({ type: 'success', text: '已保存' });
    } catch (err) {
      setDaysMessage({ type: 'error', text: err.response?.data?.msg || '保存失败' });
    } finally {
      setSavingDays(false);
    }
  };

  const saveDial = async () => {
    setDialMessage(null);
    setSavingDial(true);
    try {
      await Promise.all([
        api.put('/admin/config', { key: 'dial_window_start', value: String(dialWindowStart) }),
        api.put('/admin/config', { key: 'dial_window_end', value: String(dialWindowEnd) }),
        api.put('/admin/config', { key: 'dial_max_per_24h', value: String(dialMaxPer24h) }),
      ]);
      setDialMessage({ type: 'success', text: '已保存' });
    } catch (err) {
      setDialMessage({ type: 'error', text: err.response?.data?.msg || '保存失败' });
    } finally {
      setSavingDial(false);
    }
  };

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            )}
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">系统设置</div>
          </div>
          <button
            onClick={toggle}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {dark ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </header>
        <div className="p-4 lg:p-6 max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm">
            <div className="px-4 py-4 border-b dark:border-gray-700">
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">推送配置</h1>
            </div>
            <div className="p-4 lg:p-6">
              <SettingRow label="PushPlus Token">
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type={showToken ? 'text' : 'password'}
                      className={inputCls}
                      value={token}
                      onChange={(e) => { setToken(e.target.value); setTokenDirty(true); }}
                      placeholder="输入 Token 后每晚 20:00 自动推送"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      className="px-3 py-2 rounded-lg border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={saveToken}
                      disabled={savingToken || loading}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                    >
                      <Save className="w-4 h-4" />
                      保存
                    </button>
                  </div>
                  <a
                    href="https://www.pushplus.plus"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    获取 Token →
                  </a>
                  <RowMessage state={tokenMessage} />
                </div>
              </SettingRow>

              <SettingRow label="未跟进预警天数">
                <div className="space-y-2">
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min="1"
                      max="30"
                      className={inputCls}
                      value={staleDays}
                      onChange={(e) => setStaleDays(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={saveDays}
                      disabled={savingDays || loading}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                    >
                      <Save className="w-4 h-4" />
                      保存
                    </button>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    A 级学员超过 X 天无跟进记录时推送预警.
                  </div>
                  <RowMessage state={daysMessage} />
                </div>
              </SettingRow>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm mt-4">
            <div className="px-4 py-4 border-b dark:border-gray-700 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">AI 分析</h1>
            </div>
            <div className="p-4 lg:p-6 space-y-1">
              <SettingRow label="分析引擎">
                <div className="space-y-2">
                  <select
                    className={inputCls}
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value)}
                  >
                    <option value="deepseek">DeepSeek</option>
                    <option value="mimo">小米 MiMo</option>
                    <option value="custom">自定义（OpenAI 兼容）</option>
                  </select>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    选择通话分析使用的大模型。对应密钥留空时回退到关键词匹配模式。
                  </div>
                </div>
              </SettingRow>

              {aiProvider === 'deepseek' && (
                <SettingRow label="DeepSeek API Key">
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type={showDsKey ? 'text' : 'password'}
                        className={inputCls}
                        value={dsKey}
                        onChange={(e) => { setDsKey(e.target.value); setDsKeyDirty(true); }}
                        placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDsKey((v) => !v)}
                        className="px-3 py-2 rounded-lg border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {showDsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <a
                      href="https://platform.deepseek.com/api_keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      获取 API Key →
                    </a>
                  </div>
                </SettingRow>
              )}

              {aiProvider === 'mimo' && (
                <>
                  <SettingRow label="MiMo API Key">
                    <div className="flex gap-2">
                      <input
                        type={showMimoKey ? 'text' : 'password'}
                        className={inputCls}
                        value={mimoKey}
                        onChange={(e) => { setMimoKey(e.target.value); setMimoKeyDirty(true); }}
                        placeholder="tp-xxxxxxxxxxxxxxxx"
                      />
                      <button
                        type="button"
                        onClick={() => setShowMimoKey((v) => !v)}
                        className="px-3 py-2 rounded-lg border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {showMimoKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </SettingRow>
                  <SettingRow label="接口地址">
                    <input
                      className={inputCls}
                      value={mimoBase}
                      onChange={(e) => setMimoBase(e.target.value)}
                      placeholder="https://token-plan-sgp.xiaomimimo.com/v1"
                    />
                  </SettingRow>
                  <SettingRow label="模型名">
                    <input
                      className={inputCls}
                      value={mimoModel}
                      onChange={(e) => setMimoModel(e.target.value)}
                      placeholder="mimo-v2.5-pro"
                    />
                  </SettingRow>
                </>
              )}

              {aiProvider === 'custom' && (
                <>
                  <SettingRow label="API Key">
                    <div className="flex gap-2">
                      <input
                        type={showCustomKey ? 'text' : 'password'}
                        className={inputCls}
                        value={customKey}
                        onChange={(e) => { setCustomKey(e.target.value); setCustomKeyDirty(true); }}
                        placeholder="API Key"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCustomKey((v) => !v)}
                        className="px-3 py-2 rounded-lg border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {showCustomKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </SettingRow>
                  <SettingRow label="接口地址">
                    <input
                      className={inputCls}
                      value={customBase}
                      onChange={(e) => setCustomBase(e.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                  </SettingRow>
                  <SettingRow label="模型名">
                    <input
                      className={inputCls}
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="model-name"
                    />
                  </SettingRow>
                </>
              )}

              <div className="flex items-center justify-between pt-4">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  改完无需重启，下次通话分析即生效。
                </div>
                <button
                  type="button"
                  onClick={saveAi}
                  disabled={savingAi || loading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  保存
                </button>
              </div>
              <RowMessage state={aiMessage} />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm mt-4">
            <div className="px-4 py-4 border-b dark:border-gray-700 flex items-center gap-2">
              <Phone className="w-5 h-5 text-green-600 dark:text-green-400" />
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">拨号设置</h1>
            </div>
            <div className="p-4 lg:p-6">
              <SettingRow label="拨号窗口开始">
                <input
                  type="time"
                  className={inputCls}
                  value={dialWindowStart}
                  onChange={(e) => setDialWindowStart(e.target.value)}
                />
              </SettingRow>
              <SettingRow label="拨号窗口结束">
                <input
                  type="time"
                  className={inputCls}
                  value={dialWindowEnd}
                  onChange={(e) => setDialWindowEnd(e.target.value)}
                />
              </SettingRow>
              <SettingRow label="24 小时内最多拨打次数">
                <input
                  type="number"
                  min="1"
                  max="20"
                  className={inputCls}
                  value={dialMaxPer24h}
                  onChange={(e) => setDialMaxPer24h(e.target.value)}
                />
              </SettingRow>
              <div className="flex items-center justify-between pt-4">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  仅允许在窗口时段内拨打；同一学生 24h 内被任意坐席拨打超过该次数将被拦截。
                </div>
                <button
                  type="button"
                  onClick={saveDial}
                  disabled={savingDial || loading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  保存
                </button>
              </div>
              <RowMessage state={dialMessage} />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm mt-4">
            <div className="px-4 py-4 border-b dark:border-gray-700 flex items-center justify-between">
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">数据备份</h1>
              <button
                type="button"
                onClick={triggerBackup}
                disabled={backingUp}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${backingUp ? 'animate-spin' : ''}`} />
                {backingUp ? '备份中…' : '立即备份'}
              </button>
            </div>
            <div className="p-4 lg:p-6">
              <RowMessage state={backupMessage} />
              {backups.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400 py-4">
                  暂无备份。系统每 6 小时自动备份一次，也可点击"立即备份"手动触发。
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {backups.map((b) => (
                    <li
                      key={b.name}
                      className="py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                          {b.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {b.modified_at?.replace('T', ' ').slice(0, 19)} · {formatBytes(b.size)}
                        </div>
                      </div>
                      <a
                        href={`/api/admin/backups/${encodeURIComponent(b.name)}`}
                        download
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <Download className="w-4 h-4" />
                        下载
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </main>
    </AdminLayout>
  );
}
