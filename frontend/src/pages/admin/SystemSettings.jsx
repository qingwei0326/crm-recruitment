import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  RefreshCw,
  Save,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { adminPageMainClass } from '../../components/admin/AdminPagePrimitives';
import { formatDuration } from '../../utils';
import { dashboardLeadUrls } from './adminWorkflow';
import AssistantSettings from './settings/AssistantSettings';

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

function StatusPill({ status }) {
  const normalized = status || 'ok';
  const style = normalized === 'ok'
    ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800'
    : normalized === 'warning'
      ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'
      : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800';
  const label = normalized === 'ok' ? '正常' : normalized === 'warning' ? '需关注' : '异常';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${style}`}>
      {normalized === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}

function OpsMetric({ label, value, tone = 'default', to }) {
  const valueCls = tone === 'warning'
    ? 'text-amber-700 dark:text-amber-400'
    : tone === 'danger'
      ? 'text-red-700 dark:text-red-400'
      : 'text-gray-900 dark:text-gray-100';
  const body = (
    <div className="h-full min-w-0 rounded-r-lg border-l-2 border-gray-200 bg-gray-50/50 py-1.5 pl-3 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{label}</div>
      <div className={`mt-1 truncate text-lg font-bold tracking-tight ${valueCls}`}>{value}</div>
    </div>
  );
  if (!to) return body;
  return (
    <Link to={to} className="block h-full rounded-lg transition hover:bg-gray-100 dark:hover:bg-gray-700/80">
      {body}
    </Link>
  );
}

function recordingCounts(metrics = {}) {
  const compatibilityUnrecorded = Number(metrics.unrecorded_calls || 0);
  return {
    completed: Number(metrics.completed_dial_sessions ?? metrics.recorded_calls ?? 0),
    pending: Number(
      metrics.pending_dial_sessions == null
        ? compatibilityUnrecorded
        : metrics.pending_dial_sessions,
    ),
    legacy: Number(metrics.legacy_missing_duration ?? 0),
  };
}

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
  const [tokenMessage, setTokenMessage] = useState(null);
  const [savingToken, setSavingToken] = useState(false);
  const [scoreDailyCallTarget, setScoreDailyCallTarget] = useState('30');
  const [scoreMessage, setScoreMessage] = useState(null);
  const [savingScore, setSavingScore] = useState(false);
  const [backups, setBackups] = useState([]);
  const [backupMessage, setBackupMessage] = useState(null);
  const [backingUp, setBackingUp] = useState(false);
  const [opsHealth, setOpsHealth] = useState(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsMessage, setOpsMessage] = useState(null);
  const [dataQuality, setDataQuality] = useState(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityMessage, setQualityMessage] = useState(null);
  const [consistency, setConsistency] = useState(null);
  const [consistencyLoading, setConsistencyLoading] = useState(false);
  const [consistencyMessage, setConsistencyMessage] = useState(null);

  const closeSidebar = () => setSidebarOpen(false);

  const loadBackups = async () => {
    try {
      const res = await api.get('/admin/backups');
      setBackups(res.data.data || []);
    } catch {
      // 静默失败，下次刷新自然重试
    }
  };

  const loadOpsHealth = async () => {
    setOpsLoading(true);
    setOpsMessage(null);
    try {
      const res = await api.get('/admin/ops-health');
      setOpsHealth(res.data.data || null);
    } catch (err) {
      setOpsMessage({ type: 'error', text: err.response?.data?.msg || '运行状态加载失败' });
    } finally {
      setOpsLoading(false);
    }
  };

  const loadDataQuality = async () => {
    setQualityLoading(true);
    setQualityMessage(null);
    try {
      const res = await api.get('/admin/data-quality');
      setDataQuality(res.data.data || null);
    } catch (err) {
      setQualityMessage({ type: 'error', text: err.response?.data?.msg || '数据质量加载失败' });
    } finally {
      setQualityLoading(false);
    }
  };

  const runConsistencyAudit = async () => {
    setConsistencyLoading(true);
    setConsistencyMessage(null);
    try {
      const res = await api.get('/admin/domain-consistency');
      setConsistency(res.data.data || null);
    } catch (err) {
      setConsistencyMessage({ type: 'error', text: err.response?.data?.msg || '一致性巡检失败' });
    } finally {
      setConsistencyLoading(false);
    }
  };

  const triggerBackup = async () => {
    setBackupMessage(null);
    setBackingUp(true);
    try {
      await api.post('/admin/backups');
      setBackupMessage({ type: 'success', text: '备份已生成' });
      await loadBackups();
      await loadOpsHealth();
      await loadDataQuality();
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
      setScoreDailyCallTarget(cfg.score_daily_call_target || '30');
    } finally {
      setLoading(false);
    }
  };

  const saveScoreSettings = async () => {
    setScoreMessage(null);
    setSavingScore(true);
    try {
      await api.put('/admin/config', {
        key: 'score_daily_call_target',
        value: String(scoreDailyCallTarget),
      });
      setScoreMessage({ type: 'success', text: '已保存' });
    } catch (err) {
      setScoreMessage({ type: 'error', text: err.response?.data?.msg || '保存失败' });
    } finally {
      setSavingScore(false);
    }
  };

  useEffect(() => {
    loadConfig().catch(() => setLoading(false));
    loadBackups();
    loadOpsHealth();
    loadDataQuality();
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

  const todayRecording = recordingCounts(dataQuality?.calls?.today);
  const monthRecording = recordingCounts(dataQuality?.calls?.month);
  const monthAverageDuration = Number(
    dataQuality?.calls?.month?.avg_recorded_duration_seconds || 0,
  );

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar} compactSidebar={!isMobile}>
      <main className={adminPageMainClass}>
        <PageHeader
          title="系统设置"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        >
          <button
            onClick={toggle}
            className="min-w-10 min-h-10 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={dark ? '亮色模式' : '暗色模式'}
          >
            {dark ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </PageHeader>

        <div className="border-b border-gray-200 bg-white/90 px-4 backdrop-blur lg:sticky lg:top-14 lg:z-10 lg:px-6 dark:border-gray-800 dark:bg-gray-900/90">
          <nav className="mx-auto flex max-w-[1600px] flex-wrap gap-x-6 gap-y-1 py-2.5 text-xs font-medium text-gray-600 dark:text-gray-400" aria-label="系统设置分区">
            <a href="#system-health" aria-label="跳转到运行状态" className="whitespace-nowrap transition hover:text-blue-600 dark:hover:text-blue-400">运行</a>
            <a href="#data-quality" aria-label="跳转到数据质量" className="whitespace-nowrap transition hover:text-blue-600 dark:hover:text-blue-400">质量</a>
            <a href="#push-settings" aria-label="跳转到推送配置" className="whitespace-nowrap transition hover:text-blue-600 dark:hover:text-blue-400">推送</a>
            <a href="#ai-settings" aria-label="跳转到 AI 分析" className="whitespace-nowrap transition hover:text-blue-600 dark:hover:text-blue-400">AI</a>
            <a href="#score-settings" aria-label="跳转到评分设置" className="whitespace-nowrap transition hover:text-blue-600 dark:hover:text-blue-400">评分</a>
            <a href="#backup-settings" aria-label="跳转到数据备份" className="whitespace-nowrap transition hover:text-blue-600 dark:hover:text-blue-400">备份</a>
          </nav>
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="mx-auto w-full max-w-[1600px] space-y-6 p-4 lg:p-6">
          <div id="system-health" className="scroll-mt-[110px] rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3.5 dark:border-gray-700">
              <div className="min-w-0 flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">运行状态</h1>
                {opsHealth && <StatusPill status={opsHealth.status} />}
              </div>
              <button
                type="button"
                onClick={loadOpsHealth}
                disabled={opsLoading}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${opsLoading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
            <div className="p-4 lg:p-6">
              <RowMessage state={opsMessage} />
              {opsHealth ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
                    <OpsMetric label="数据库延迟" value={`${opsHealth.database?.db_ms ?? '-'} ms`} />
                    <OpsMetric
                      label="最新备份"
                      value={opsHealth.backups?.latest?.modified_at
                        ? opsHealth.backups.latest.modified_at.replace('T', ' ').slice(0, 19)
                        : '无备份'}
                      tone={opsHealth.backups?.latest ? 'default' : 'warning'}
                    />
                    <OpsMetric label="备份数量" value={`${opsHealth.backups?.count ?? 0}/${opsHealth.backups?.max_keep ?? '-'}`} />
                    <OpsMetric
                      label="逾期回访"
                      value={opsHealth.business?.overdue_follow_ups ?? 0}
                      tone={opsHealth.business?.overdue_follow_ups > 0 ? 'warning' : 'default'}
                      to="/admin/work-center?queue=follow"
                    />
                    <OpsMetric
                      label="7 天通知失败"
                      value={opsHealth.business?.notification_failures_7d ?? 0}
                      tone={opsHealth.business?.notification_failures_7d > 0 ? 'warning' : 'default'}
                    />
                    <OpsMetric
                      label="24 小时前端错误"
                      value={opsHealth.business?.frontend_errors_24h ?? 0}
                      tone={opsHealth.business?.frontend_errors_24h > 0 ? 'warning' : 'default'}
                    />
                    <OpsMetric
                      label="可分配有效线索"
                      value={opsHealth.business?.unassigned_active ?? 0}
                      to={dashboardLeadUrls.availableUnassigned}
                    />
                    <OpsMetric label="活跃话务员" value={opsHealth.business?.active_agents ?? 0} />
                    <OpsMetric
                      label="锁定账号"
                      value={opsHealth.business?.locked_users ?? 0}
                      tone={opsHealth.business?.locked_users > 0 ? 'warning' : 'default'}
                    />
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1.5 border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-700/60 dark:text-gray-400">
                    <div>生成时间：{opsHealth.generated_at?.replace('T', ' ').slice(0, 19) || '-'}</div>
                    <div>日志文件：{opsHealth.logs?.files?.filter((item) => item.exists).length ?? 0} 个可用</div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400 py-4">
                  {opsLoading ? '运行状态加载中…' : '暂未加载运行状态'}
                </div>
              )}
            </div>
          </div>

          <div id="data-quality" className="scroll-mt-[110px] rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3.5 dark:border-gray-700">
              <div className="min-w-0 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">数据质量</h1>
                {dataQuality && <StatusPill status={dataQuality.status} />}
              </div>
              <button
                type="button"
                onClick={loadDataQuality}
                disabled={qualityLoading}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${qualityLoading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
            <div className="p-4 lg:p-6">
              <RowMessage state={qualityMessage} />
              {dataQuality ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
                    <OpsMetric
                      label="今日待完成"
                      value={todayRecording.pending}
                      tone={todayRecording.pending > 0 ? 'warning' : 'default'}
                      to="/admin/report-center?tab=call-volume"
                    />
                    <OpsMetric
                      label="今日历史未回填"
                      value={todayRecording.legacy}
                      to="/admin/report-center?tab=call-volume"
                    />
                    <OpsMetric
                      label="本月已完成"
                      value={monthRecording.completed}
                      to="/admin/report-center?tab=call-volume"
                    />
                    <OpsMetric
                      label="本月待完成"
                      value={monthRecording.pending}
                      tone={monthRecording.pending > 0 ? 'warning' : 'default'}
                      to="/admin/report-center?tab=call-volume"
                    />
                    <OpsMetric
                      label="本月历史未回填"
                      value={monthRecording.legacy}
                      to="/admin/report-center?tab=call-volume"
                    />
                    <OpsMetric
                      label="平均流程耗时"
                      value={monthAverageDuration > 0 ? formatDuration(monthAverageDuration) : '-'}
                    />
                    <OpsMetric
                      label="无电话数据"
                      value={dataQuality.students?.missing_phone_tasks ?? 0}
                      tone={dataQuality.students?.missing_phone_tasks > 0 ? 'warning' : 'default'}
                      to={dashboardLeadUrls.missingPhone}
                    />
                    <OpsMetric
                      label="可分配有效线索"
                      value={dataQuality.students?.unassigned_active ?? 0}
                      to={dashboardLeadUrls.availableUnassigned}
                    />
                    <OpsMetric label="无效线索" value={dataQuality.students?.invalid_total ?? 0} to="/admin/invalid-reclaim" />
                    <OpsMetric
                      label="逾期回访"
                      value={dataQuality.follow_ups?.overdue_follow_ups ?? 0}
                      tone={dataQuality.follow_ups?.overdue_follow_ups > 0 ? 'warning' : 'default'}
                      to="/admin/work-center?queue=follow"
                    />
                  </div>

                  <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                          领域一致性巡检
                        </span>
                        {consistency && <StatusPill status={consistency.status} />}
                      </div>
                      <button
                        type="button"
                        onClick={runConsistencyAudit}
                        disabled={consistencyLoading}
                        className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        <RefreshCw className={`h-4 w-4 ${consistencyLoading ? 'animate-spin' : ''}`} />
                        运行巡检
                      </button>
                    </div>
                    <RowMessage state={consistencyMessage} />
                    {consistency && (
                      <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                        {consistency.status === 'ok'
                          ? '未发现状态、负责人、工作项或分配历史不一致。'
                          : `发现 ${consistency.failed_checks?.length || 0} 项异常：${consistency.failed_checks?.join('、') || '请查看巡检结果'}`}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">待完成拨号排行</div>
                      {dataQuality.calls?.agents?.length ? (
                        <div className="space-y-2">
                          {dataQuality.calls.agents.slice(0, 5).map((agent) => {
                            const recording = recordingCounts(agent);
                            const pendingRatio = Number(agent.total_calls || 0) > 0
                              ? Math.round((recording.pending / Number(agent.total_calls)) * 1000) / 10
                              : 0;
                            const averageDuration = Number(agent.avg_recorded_duration_seconds || 0);
                            return (
                              <div key={agent.agent_id} className="flex items-center justify-between gap-3 text-sm">
                                <div className="min-w-0">
                                  <div className="font-medium text-gray-800 dark:text-gray-100 truncate">{agent.agent_name}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">
                                    总拨号 {agent.total_calls} · 已完成 {recording.completed} · 历史未回填 {recording.legacy} · 流程均耗 {averageDuration > 0 ? formatDuration(averageDuration) : '-'}
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="font-semibold text-amber-700 dark:text-amber-300">{recording.pending}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">{pendingRatio}%</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400">暂无本月拨号记录</div>
                      )}
                    </div>

                    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">无效原因分布</div>
                      {dataQuality.students?.invalid_reasons?.length ? (
                        <div className="flex flex-wrap gap-2">
                          {dataQuality.students.invalid_reasons.map((item) => (
                            <span
                              key={item.reason}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1 text-sm text-gray-700 dark:text-gray-200"
                            >
                              {item.reason}
                              <b>{item.count}</b>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400">暂无无效线索</div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-700/60 dark:text-gray-400">
                    生成时间：{dataQuality.generated_at?.replace('T', ' ').slice(0, 19) || '-'}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400 py-4">
                  {qualityLoading ? '数据质量加载中…' : '暂未加载数据质量'}
                </div>
              )}
            </div>
          </div>

          <div className="mx-auto w-full max-w-5xl space-y-6">
          <div id="push-settings" className="scroll-mt-[110px] rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b px-4 py-3.5 dark:border-gray-700">
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">推送配置</h1>
            </div>
            <div className="p-4 lg:p-6">
              <SettingRow label="PushPlus Token">
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      aria-label="PushPlus Token"
                      type={showToken ? 'text' : 'password'}
                      className={inputCls}
                      value={token}
                      onChange={(e) => { setToken(e.target.value); setTokenDirty(true); }}
                      placeholder="输入 Token 后每晚 20:00 自动推送"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      className="min-w-10 min-h-10 px-3 py-2 rounded-lg border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      aria-label={showToken ? '隐藏 PushPlus Token' : '显示 PushPlus Token'}
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
                    className="inline-flex min-h-9 items-center text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    获取 Token →
                  </a>
                  <RowMessage state={tokenMessage} />
                </div>
              </SettingRow>

            </div>
          </div>

          <div id="ai-settings" className="scroll-mt-[110px] rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2 border-b px-4 py-3.5 dark:border-gray-700">
              <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">AI 分析</h1>
            </div>
            <div className="p-4 lg:p-6 space-y-1">
              <SettingRow label="分析引擎">
                <div className="space-y-2">
                  <select
                    aria-label="AI 分析引擎"
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
                        aria-label="DeepSeek API Key"
                        type={showDsKey ? 'text' : 'password'}
                        className={inputCls}
                        value={dsKey}
                        onChange={(e) => { setDsKey(e.target.value); setDsKeyDirty(true); }}
                        placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDsKey((v) => !v)}
                        className="min-w-10 min-h-10 px-3 py-2 rounded-lg border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        aria-label={showDsKey ? '隐藏 DeepSeek API Key' : '显示 DeepSeek API Key'}
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
                        aria-label="MiMo API Key"
                        type={showMimoKey ? 'text' : 'password'}
                        className={inputCls}
                        value={mimoKey}
                        onChange={(e) => { setMimoKey(e.target.value); setMimoKeyDirty(true); }}
                        placeholder="tp-xxxxxxxxxxxxxxxx"
                      />
                      <button
                        type="button"
                        onClick={() => setShowMimoKey((v) => !v)}
                        className="min-w-10 min-h-10 px-3 py-2 rounded-lg border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        aria-label={showMimoKey ? '隐藏 MiMo API Key' : '显示 MiMo API Key'}
                      >
                        {showMimoKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </SettingRow>
                  <SettingRow label="接口地址">
                    <input
                      aria-label="MiMo 接口地址"
                      className={inputCls}
                      value={mimoBase}
                      onChange={(e) => setMimoBase(e.target.value)}
                      placeholder="https://token-plan-sgp.xiaomimimo.com/v1"
                    />
                  </SettingRow>
                  <SettingRow label="模型名">
                    <input
                      aria-label="MiMo 模型名"
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
                        aria-label="自定义 API Key"
                        type={showCustomKey ? 'text' : 'password'}
                        className={inputCls}
                        value={customKey}
                        onChange={(e) => { setCustomKey(e.target.value); setCustomKeyDirty(true); }}
                        placeholder="API Key"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCustomKey((v) => !v)}
                        className="min-w-10 min-h-10 px-3 py-2 rounded-lg border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        aria-label={showCustomKey ? '隐藏自定义 API Key' : '显示自定义 API Key'}
                      >
                        {showCustomKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </SettingRow>
                  <SettingRow label="接口地址">
                    <input
                      aria-label="自定义接口地址"
                      className={inputCls}
                      value={customBase}
                      onChange={(e) => setCustomBase(e.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                  </SettingRow>
                  <SettingRow label="模型名">
                    <input
                      aria-label="自定义模型名"
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

          <AssistantSettings />

          <div id="score-settings" className="scroll-mt-[110px] rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2 border-b px-4 py-3.5 dark:border-gray-700">
              <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">评分设置</h1>
            </div>
            <div className="p-4 lg:p-6">
              <SettingRow label="默认通话目标">
                <label className="sr-only" htmlFor="score-daily-call-target">默认通话目标</label>
                <input
                  id="score-daily-call-target"
                  type="number"
                  min="1"
                  max="1000"
                  className={inputCls}
                  value={scoreDailyCallTarget}
                  onChange={(e) => setScoreDailyCallTarget(e.target.value)}
                />
              </SettingRow>
              <div className="flex items-center justify-between pt-4">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  评分预览未手动输入目标时使用该值；页面上仍可临时试算其他目标，最高 1000。
                </div>
                <button
                  type="button"
                  onClick={saveScoreSettings}
                  disabled={savingScore || loading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  保存
                </button>
              </div>
              <RowMessage state={scoreMessage} />
            </div>
          </div>

          <div id="backup-settings" className="scroll-mt-[110px] rounded-lg border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between border-b px-4 py-3.5 dark:border-gray-700">
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
                        className="inline-flex min-h-9 items-center gap-1.5 px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
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
        </form>
      </main>
    </AdminLayout>
  );
}
