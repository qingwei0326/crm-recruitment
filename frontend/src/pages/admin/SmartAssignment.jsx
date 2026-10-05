import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Moon,
  RefreshCcw,
  Send,
  Sun,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { adminPageMainClass } from '../../components/admin/AdminPagePrimitives';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import { getApiErrorMessage } from '../../utils';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { ADMIN_OPERATION_PERMISSIONS, canPerformAdminOperation } from '../../adminPermissions';

const numberFmt = new Intl.NumberFormat('zh-CN');

function fmt(value) {
  return numberFmt.format(Number(value || 0));
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-panel border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
        {fmt(value)}
      </div>
      {hint && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
    </div>
  );
}

export default function SmartAssignment() {
  const { dark, toggle } = useTheme();
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const [region, setRegion] = useState('');
  const [limit, setLimit] = useState('500');
  const [perAgentLimit, setPerAgentLimit] = useState('100');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState(null);
  const canExecute = canPerformAdminOperation(
    user,
    ADMIN_OPERATION_PERMISSIONS.studentAssign,
  );
  const closeSidebar = () => setSidebarOpen(false);

  const previewParams = useMemo(() => ({
    school_name: schoolName.trim(),
    region: region.trim(),
    limit: Number(limit || 500),
    per_agent_limit: Number(perAgentLimit || 100),
  }), [schoolName, region, limit, perAgentLimit]);

  const loadPreview = async ({ clearExecuteResult = true } = {}) => {
    setLoading(true);
    if (clearExecuteResult) setExecuteResult(null);
    try {
      const res = await api.get('/admin/smart-assign/preview', { params: previewParams });
      if (res.data.code === 0) {
        setPreview(res.data.data || null);
      } else {
        toast?.error(res.data.msg || '加载智能分配预览失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!canExecute || !preview?.plan?.planned) return;
    const ok = await confirm({
      title: '确认执行智能分配',
      message: `将按当前预览分配 ${preview.plan.planned} 条线索。执行时服务端会重新计算，实际数量可能变化。`,
      confirmText: '确认分配',
    });
    if (!ok) return;
    setExecuting(true);
    try {
      const res = await api.post('/admin/smart-assign/execute', {
        ...previewParams,
        confirm: true,
      });
      if (res.data.code === 0) {
        const data = res.data.data || {};
        toast?.success(`智能分配已执行：${data.assigned_count || 0} 条`);
        await loadPreview({ clearExecuteResult: false });
        setExecuteResult(data);
      } else {
        toast?.error(res.data.msg || '智能分配执行失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setExecuting(false);
    }
  };

  useEffect(() => {
    loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pool = preview?.pool || {};
  const plan = preview?.plan || { planned: 0, per_agent: [] };
  const warnings = preview?.warnings || [];

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar} compactSidebar={!isMobile}>
      <main className={adminPageMainClass}>
        <PageHeader title="智能分配" isMobile={isMobile} onMenuClick={() => setSidebarOpen(true)}>
          <button type="button" onClick={toggle} aria-label={dark ? '亮色模式' : '暗色模式'}>
            {dark ? (
              <Sun className="h-5 w-5 text-amber-400" />
            ) : (
              <Moon className="h-5 w-5 text-gray-500" />
            )}
          </button>
        </PageHeader>

        <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
          <section className="rounded-panel border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              筛选与参数
            </h2>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <label className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-200">
                学校
                <input
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <label className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-200">
                地区
                <input
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <label className="w-full text-sm font-medium text-gray-700 dark:text-gray-200 lg:w-40">
                本次分配总量
                <input
                  type="number"
                  min="1"
                  max="5000"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <label className="w-full text-sm font-medium text-gray-700 dark:text-gray-200 lg:w-40">
                单坐席上限
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={perAgentLimit}
                  onChange={(e) => setPerAgentLimit(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <button
                type="button"
                onClick={loadPreview}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
                刷新预览
              </button>
            </div>
          </section>

          {warnings.length > 0 && (
            <section className="space-y-2">
              {warnings.map((warning) => (
                <div
                  key={warning}
                  className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"
                >
                  <AlertTriangle className="h-4 w-4" />
                  {warning}
                </div>
              ))}
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              分配池概览
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="未分配线索" value={pool.total_unassigned} />
              <Metric label="可分配线索" value={pool.eligible_total} />
              <Metric label="重复手机号排除" value={pool.excluded_duplicate_phone} />
              <Metric label="状态/资料排除" value={pool.excluded_invalid_status} />
            </div>
          </section>

          <section className="rounded-panel border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">坐席负载</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 text-left">坐席</th>
                    <th className="px-3 py-2 text-right">活跃任务</th>
                    <th className="px-3 py-2 text-right">未联系</th>
                    <th className="px-3 py-2 text-right">今日拨号</th>
                    <th className="px-3 py-2 text-right">近7天处理</th>
                    <th className="px-3 py-2 text-right">逾期回访</th>
                    <th className="px-3 py-2 text-right">负载分</th>
                    <th className="px-3 py-2 text-right">建议新增</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {(preview?.agents || []).map((agent) => (
                    <tr key={agent.agent_id}>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                        {agent.agent_name}
                      </td>
                      <td className="px-3 py-2 text-right">{fmt(agent.active_tasks)}</td>
                      <td className="px-3 py-2 text-right">{fmt(agent.not_contacted)}</td>
                      <td className="px-3 py-2 text-right">{fmt(agent.today_calls)}</td>
                      <td className="px-3 py-2 text-right">{fmt(agent.handled_7d)}</td>
                      <td className="px-3 py-2 text-right">{fmt(agent.overdue_follow_ups)}</td>
                      <td className="px-3 py-2 text-right">{agent.load_score}</td>
                      <td className="px-3 py-2 text-right font-semibold text-blue-600">
                        {fmt(agent.suggested_count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!preview?.agents || preview.agents.length === 0) && (
                <div className="py-8 text-center text-sm text-gray-400">暂无可用坐席</div>
              )}
            </div>
          </section>

          <section className="rounded-panel border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">分配建议</h2>
              <div className="text-sm font-semibold text-blue-600">
                计划分配 {fmt(plan.planned)} 条
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(plan.per_agent || []).map((item) => (
                <div key={item.agent_id} className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {item.agent_name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    新增 {fmt(item.count)} 条
                  </div>
                </div>
              ))}
            </div>
            {(!plan.per_agent || plan.per_agent.length === 0) && (
              <div className="mt-3 rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-400 dark:bg-gray-900/40">
                暂无可执行分配建议
              </div>
            )}
            {executeResult && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  批次 {executeResult.batch_id}，实际分配 {fmt(executeResult.assigned_count)} 条，跳过{' '}
                  {fmt(executeResult.skipped_count)} 条
                </span>
                {executeResult.batch_id && (
                  <Link
                    to={`/admin/assignment-batches/${encodeURIComponent(executeResult.batch_id)}/review`}
                    className="rounded-full bg-white px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-200"
                  >
                    查看复盘
                  </Link>
                )}
              </div>
            )}
            {canExecute && plan.planned > 0 && (
              <button
                type="button"
                onClick={handleExecute}
                disabled={executing}
                className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 text-sm font-medium text-white disabled:opacity-60"
              >
                {executing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                确认执行智能分配
              </button>
            )}
            {!canExecute && (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                当前账号仅可查看预览；执行智能分配需要“分配/改派学生”权限。
              </div>
            )}
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
