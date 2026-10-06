import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ListFilter,
  Loader2,
  RefreshCcw,
  School,
  ShieldAlert,
  Users,
  Activity,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import useIsMobile from '../../hooks/useIsMobile';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { AdminPageContainer, adminPageMainClass } from '../../components/admin/AdminPagePrimitives';
import api from '../../api';
import { getApiErrorMessage, unwrapApiResponse } from '../../utils';
import logger from '../../utils/logger';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import {
  ADMIN_OPERATION_PERMISSIONS,
  canPerformAdminOperation,
} from '../../adminPermissions';

const workflows = [
  {
    step: '1',
    title: '学生管理与分配',
    description: '新增、筛选、批量选择线索，并进行手动分配、自动分配和学校分发。',
    outcome: '适合日常查找、少量手动调整和批量分配。',
    to: '/admin/leads',
    icon: ListFilter,
    tone: 'blue',
  },
  {
    step: '2',
    title: '智能分配',
    description: '按未分配池和坐席负载生成公平分配建议，管理员确认后批量执行。',
    outcome: '适合每天批量补齐坐席任务量，并保留批次回滚。',
    to: '/admin/smart-assign',
    icon: RefreshCcw,
    tone: 'amber',
  },
  {
    step: '3',
    title: '无效线索回收',
    description: '按学校汇总无效线索，批量回收后重新进入未分配池。',
    outcome: '适合先按原因/学校预览，再回收到未分配池或删除。',
    to: '/admin/invalid-reclaim',
    icon: RefreshCcw,
    tone: 'red',
  },
  {
    step: '4',
    title: '多学校分发',
    description: '按学校批量选择未分配学员，自动均摊或指定分发给话务员。',
    outcome: '适合处理成批学校线索，减少逐条分配。',
    to: '/admin/distribute',
    icon: School,
    tone: 'green',
  },
];

const toneClasses = {
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  green: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

const severityClasses = {
  high: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300',
  low: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
};

const healthSeverityClasses = {
  high: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200',
  medium: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200',
  low: 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200',
};

function auditHref(alert) {
  const params = new URLSearchParams();
  if (alert.category) params.set('category', alert.category);
  if (alert.action) params.set('action', alert.action);
  if (alert.batch_id) params.set('batch_id', alert.batch_id);
  if (alert.q) params.set('q', alert.q);
  return `/admin/audit-logs?${params.toString()}`;
}

function alertHref(alert) {
  return alert.to || auditHref(alert);
}

function duplicateSearchHref(group) {
  const searchText = group.search_q || group.key || '';
  return `/admin/leads?q=${encodeURIComponent(searchText)}`;
}

function governanceReviewKey(item, fallback = '') {
  return item?.review_key || fallback;
}

function reviewSnapshotCount(item) {
  const rawCurrentCount = item?.current_count;
  const currentCount = Number(rawCurrentCount);
  if (rawCurrentCount !== undefined && rawCurrentCount !== null && Number.isFinite(currentCount)) {
    return Math.max(currentCount, 0);
  }
  return Math.max(Number(item?.reviewed_count || 0) + Number(item?.count || 0), 0);
}

function isPendingReview(item) {
  return !item?.reviewed && Number(item?.count || 0) > 0;
}

export default function LeadGovernance() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [duplicateTotal, setDuplicateTotal] = useState(0);
  const [cleanupPreview, setCleanupPreview] = useState(null);
  const [riskAlerts, setRiskAlerts] = useState([]);
  const [health, setHealth] = useState(null);
  const [loadingSignals, setLoadingSignals] = useState(true);
  const [cleaningPhones, setCleaningPhones] = useState(false);
  const [reviewingKey, setReviewingKey] = useState('');
  const canCleanupPhones = canPerformAdminOperation(
    user,
    ADMIN_OPERATION_PERMISSIONS.duplicateCleanup,
  );
  const canAcknowledgeReview = canPerformAdminOperation(
    user,
    ADMIN_OPERATION_PERMISSIONS.governanceReview,
  );
  const closeSidebar = () => setSidebarOpen(false);
  const pendingHealthSignals = (health?.signals || []).filter(isPendingReview);
  const pendingRiskAlerts = riskAlerts.filter(isPendingReview);
  const showRiskAlerts = loadingSignals || pendingRiskAlerts.length > 0;

  const loadSignals = () => {
    setLoadingSignals(true);
    return Promise.allSettled([
      api.get('/admin/data-health'),
      api.get('/admin/lead-duplicates'),
      api.get('/admin/lead-duplicates/cleanup-preview'),
      api.get('/admin/risk-alerts'),
    ])
      .then(([healthResult, duplicateResult, previewResult, riskResult]) => {
        if (healthResult.status === 'fulfilled') {
          setHealth(healthResult.value.data.data || null);
        } else {
          logger.error('加载数据健康中心失败:', healthResult.reason);
        }
        if (duplicateResult.status === 'fulfilled') {
          const data = duplicateResult.value.data.data || {};
          setDuplicates(data.groups || []);
          setDuplicateTotal(data.total_groups || 0);
        } else {
          logger.error('加载重复线索治理数据失败:', duplicateResult.reason);
        }
        if (previewResult.status === 'fulfilled') {
          setCleanupPreview(previewResult.value.data.data || null);
        } else {
          logger.error('加载重复手机号清理预览失败:', previewResult.reason);
        }
        if (riskResult.status === 'fulfilled') {
          const data = riskResult.value.data.data || {};
          setRiskAlerts(data.alerts || []);
        } else {
          logger.error('加载风险操作提醒失败:', riskResult.reason);
        }
      })
      .finally(() => setLoadingSignals(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingSignals(true);
    Promise.allSettled([
      api.get('/admin/data-health'),
      api.get('/admin/lead-duplicates'),
      api.get('/admin/lead-duplicates/cleanup-preview'),
      api.get('/admin/risk-alerts'),
    ])
      .then(([healthResult, duplicateResult, previewResult, riskResult]) => {
        if (cancelled) return;
        if (healthResult.status === 'fulfilled') {
          setHealth(healthResult.value.data.data || null);
        } else {
          logger.error('加载数据健康中心失败:', healthResult.reason);
        }
        if (duplicateResult.status === 'fulfilled') {
          const data = duplicateResult.value.data.data || {};
          setDuplicates(data.groups || []);
          setDuplicateTotal(data.total_groups || 0);
        } else {
          logger.error('加载重复线索治理数据失败:', duplicateResult.reason);
        }
        if (previewResult.status === 'fulfilled') {
          setCleanupPreview(previewResult.value.data.data || null);
        } else {
          logger.error('加载重复手机号清理预览失败:', previewResult.reason);
        }
        if (riskResult.status === 'fulfilled') {
          const data = riskResult.value.data.data || {};
          setRiskAlerts(data.alerts || []);
        } else {
          logger.error('加载风险操作提醒失败:', riskResult.reason);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSignals(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runDuplicatePhoneCleanup = async () => {
    const preview = cleanupPreview || {};
    if (!preview.will_clear_count || !canCleanupPhones) return;
    const ok = await confirm({
      title: '清理重复手机号',
      message:
        `将清理 ${preview.duplicate_phone_count || 0} 个重复手机号，影响 ${preview.affected_student_count || 0} 条学生。\n` +
        `可安全清号 ${preview.will_clear_count || 0} 条；另有 ${preview.manual_review_count || 0} 条清号后无可用号码，将保留并转人工处理。\n` +
        '系统会生成审计批次号，方便在操作记录中追踪。',
      confirmText: '清理安全项',
      tone: 'warning',
    });
    if (!ok) return;
    setCleaningPhones(true);
    try {
      const res = await api.post('/admin/lead-duplicates/cleanup', { confirm: true });
      const data = res.data.data || {};
      toast?.success(`清理完成：安全清号 ${data.cleared_count || 0} 条，待人工复核 ${data.manual_review_count || 0} 条`);
      if (data.batch_id) {
        setRiskAlerts((current) => [
          {
            type: `duplicate_phone_cleanup_${data.batch_id}`,
            title: '重复手机号清理已完成',
            severity: 'medium',
            count: data.affected_student_count || 0,
            detail: `批次 ${data.batch_id}，可在操作记录中复核清理明细。`,
            batch_id: data.batch_id,
          },
          ...current,
        ]);
      }
      await loadSignals();
    } catch (e) {
      logger.error('清理重复手机号失败:', e);
      toast?.error('清理重复手机号失败');
    } finally {
      setCleaningPhones(false);
    }
  };

  const acknowledgeReview = async (item, key) => {
    if (!canAcknowledgeReview) return;
    const reviewKey = governanceReviewKey(item, key);
    if (!reviewKey || reviewingKey) return;
    setReviewingKey(reviewKey);
    try {
      const response = await api.post('/admin/governance-reviews', {
        key: reviewKey,
        title: item.title || reviewKey,
        detail: item.detail || '',
        count: reviewSnapshotCount(item),
        review_token: item.review_token || '',
      });
      unwrapApiResponse(response);
      setHealth((current) => {
        if (!current) return current;
        const signals = (current.signals || []).map((signal) => (
          governanceReviewKey(signal, signal.key) === reviewKey
            ? { ...signal, count: 0, reviewed: true }
            : signal
        ));
        return {
          ...current,
          signals,
          total_issue_count: signals.reduce(
            (total, signal) => total + (isPendingReview(signal) ? Number(signal.count || 0) : 0),
            0,
          ),
        };
      });
      setRiskAlerts((current) => current.filter(
        (alert) => governanceReviewKey(alert, alert.type) !== reviewKey,
      ));
      toast?.success('已确认复核');
      await loadSignals();
    } catch (e) {
      logger.error('确认复核失败:', e);
      toast?.error(getApiErrorMessage(e));
    } finally {
      setReviewingKey('');
    }
  };

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar} compactSidebar={!isMobile}>
      <main className={adminPageMainClass}>
        <PageHeader title="线索治理" isMobile={isMobile} onMenuClick={() => setSidebarOpen(true)} />

        <AdminPageContainer className="max-w-6xl">
          {(loadingSignals || pendingHealthSignals.length > 0) && (
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-panel shadow-sm p-4 lg:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  <Activity className="h-4 w-4 text-blue-600" />
                  数据健康中心
                </div>
                <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  先看异常信号，再进入对应明细页复核处理。
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-right dark:bg-gray-900/40">
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {health?.total_issue_count ?? 0}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">待复核项</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {loadingSignals ? (
                <div className="col-span-full py-8 text-center text-gray-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </div>
              ) : pendingHealthSignals.map((signal) => (
                <div
                  key={signal.key}
                  className={`rounded-lg border p-3 ${
                    healthSeverityClasses[signal.severity] || healthSeverityClasses.low
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{signal.title}</div>
                      <div className="mt-1 text-xs leading-5 opacity-80">{signal.detail}</div>
                    </div>
                    <span className="rounded-full bg-white/75 px-2 py-1 text-sm font-bold dark:bg-black/20">
                      {signal.count || 0}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      to={signal.to || '/admin/governance'}
                      className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white/75 px-2.5 text-xs font-medium hover:bg-white dark:bg-black/20 dark:hover:bg-black/30"
                    >
                      查看明细
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    {signal.count > 0 && canAcknowledgeReview && (
                      <button
                        type="button"
                        disabled={reviewingKey === governanceReviewKey(signal, signal.key)}
                        onClick={() => acknowledgeReview(
                          signal,
                          governanceReviewKey(signal, signal.key),
                        )}
                        aria-label={`确认已复核 ${signal.title}`}
                        className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-medium text-white disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {reviewingKey === governanceReviewKey(signal, signal.key)
                          ? '确认中...'
                          : '确认已复核'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          <div className={`grid gap-4 ${showRiskAlerts ? 'lg:grid-cols-2' : ''}`}>
            <section className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-panel shadow-sm p-4 lg:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  <Users className="h-4 w-4 text-blue-600" />
                  疑似重复线索
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {duplicateTotal} 组
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {loadingSignals ? (
                  <div className="py-8 text-center text-gray-400">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </div>
                ) : duplicates.length === 0 ? (
                  <div className="rounded-lg bg-gray-50 px-3 py-4 text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
                    暂无疑似重复组。
                  </div>
                ) : (
                  duplicates.slice(0, 3).map((group) => (
                    <div key={`${group.type}-${group.key}`} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {group.type}
                          </div>
                          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                            {group.key}
                          </div>
                        </div>
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          {group.count} 条
                        </span>
                      </div>
                      <div className="mt-3 space-y-1.5">
                        {(group.students || []).map((student) => (
                          <Link
                            key={student.id}
                            to={`/admin/leads/${student.id}`}
                            className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm hover:bg-blue-50 dark:bg-gray-900/40 dark:hover:bg-blue-900/20"
                          >
                            <span className="min-w-0 truncate text-gray-800 dark:text-gray-100">
                              查看 {student.name || `学生 ${student.id}`}
                            </span>
                            <span className="ml-3 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                              {student.school_name || '-'} · {student.status || '-'}
                            </span>
                          </Link>
                        ))}
                      </div>
                      <Link
                        to={duplicateSearchHref(group)}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400"
                      >
                        搜索该组
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  ))
                )}
                {!loadingSignals && cleanupPreview?.affected_student_count > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                    <div className="text-sm font-semibold">重复手机号清理预览</div>
                    <div className="mt-1 text-xs leading-5">
                      {cleanupPreview.duplicate_phone_count} 个重复手机号，影响 {cleanupPreview.affected_student_count} 条；
                      可安全清号 {cleanupPreview.will_clear_count} 条，需人工处理 {cleanupPreview.manual_review_count || 0} 条，系统不会删除学生或历史记录。
                    </div>
                    {canCleanupPhones && cleanupPreview.will_clear_count > 0 ? (
                      <button
                        type="button"
                        disabled={cleaningPhones}
                        onClick={runDuplicatePhoneCleanup}
                        className="mt-3 inline-flex min-h-9 items-center justify-center rounded-lg bg-amber-600 px-3 text-xs font-medium text-white disabled:opacity-60"
                      >
                        {cleaningPhones ? '清理中...' : '清理可安全处理项'}
                      </button>
                    ) : canCleanupPhones ? (
                      <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-black/20 dark:text-amber-100">
                        当前没有可自动清理项，请在重复组中逐条人工确认。
                      </div>
                    ) : (
                      <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-black/20 dark:text-amber-100">
                        当前账号仅可查看预览；清理重复手机号需授权操作权限。
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {showRiskAlerts && (
            <section className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-panel shadow-sm p-4 lg:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                  异常变更提醒
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {pendingRiskAlerts.length} 项
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {loadingSignals ? (
                  <div className="py-8 text-center text-gray-400">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </div>
                ) : (
                  pendingRiskAlerts.map((alert) => (
                    <div
                      key={alert.type}
                      className={`rounded-lg border p-3 ${severityClasses[alert.severity] || severityClasses.low}`}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{alert.title}</div>
                          <div className="mt-1 text-xs leading-5">{alert.detail}</div>
                        </div>
                        <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-medium dark:bg-black/20">
                          {alert.count}
                        </span>
                      </div>
                      <Link
                        to={alertHref(alert)}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium"
                      >
                        {alert.to ? '查看处理入口' : '查看相关操作记录'}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                      {alert.count > 0 && canAcknowledgeReview && (
                        <button
                          type="button"
                          disabled={reviewingKey === governanceReviewKey(alert, alert.type)}
                          onClick={() => acknowledgeReview(
                            alert,
                            governanceReviewKey(alert, alert.type),
                          )}
                          aria-label={`确认已复核 ${alert.title}`}
                          className="ml-3 mt-3 inline-flex min-h-8 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {reviewingKey === governanceReviewKey(alert, alert.type)
                            ? '确认中...'
                            : '确认已复核'}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {workflows.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="group bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-panel shadow-sm p-5 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${toneClasses[item.tone]}`}>
                      <span className="text-xs font-bold">{item.step}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                          <Icon className="w-4 h-4" />
                          {item.title}
                        </h2>
                        <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 shrink-0" />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                        {item.description}
                      </p>
                      <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
                        {item.outcome}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </AdminPageContainer>
      </main>
    </AdminLayout>
  );
}
