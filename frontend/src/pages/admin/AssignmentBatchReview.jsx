import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  PhoneCall,
  Users,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { adminPageMainClass } from '../../components/admin/AdminPagePrimitives';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import { formatDateTime, getApiErrorMessage } from '../../utils';

const WINDOWS = [1, 3, 7, 14];
const numberFmt = new Intl.NumberFormat('zh-CN');

function fmt(value) {
  return numberFmt.format(Number(value || 0));
}

function pct(value) {
  return `${Number(value || 0).toFixed(1).replace('.0', '')}%`;
}

function Metric({ label, value, hint, icon: Icon }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-blue-600 dark:text-blue-300" />}
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
        {fmt(value)}
      </div>
      {hint && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
    </div>
  );
}

function RateCell({ count, rate }) {
  return (
    <div className="text-right">
      <div className="font-medium text-gray-900 dark:text-gray-100">{fmt(count)}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{pct(rate)}</div>
    </div>
  );
}

export default function AssignmentBatchReview() {
  const { batchId = '' } = useParams();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [windowDays, setWindowDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');

  const encodedBatchId = useMemo(() => encodeURIComponent(batchId), [batchId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .get(`/admin/assignment-batches/${encodedBatchId}/review`, {
        params: { window_days: windowDays },
      })
      .then((res) => {
        if (!alive) return;
        if (res.data.code === 0) {
          setReview(res.data.data || null);
          return;
        }
        setReview(null);
        setError(res.data.msg || '分配批次复盘加载失败');
      })
      .catch((err) => {
        if (!alive) return;
        const msg = getApiErrorMessage(err);
        setError(msg);
        toast?.error?.(msg);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encodedBatchId, windowDays]);

  const batch = review?.batch || {};
  const funnel = review?.funnel || {};
  const agents = review?.agents || [];
  const unhandledStudents = review?.unhandled_students || [];
  const alerts = review?.alerts || [];

  return (
    <AdminLayout
      isMobile={isMobile}
      sidebarOpen={sidebarOpen}
      onClose={() => setSidebarOpen(false)}
      compactSidebar={!isMobile}
    >
      <main className={adminPageMainClass}>
        <PageHeader
          title="分配批次复盘"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        />

        <div className="mx-auto max-w-7xl space-y-4 p-4 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              to="/admin/audit-logs"
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <ArrowLeft className="h-4 w-4" />
              返回操作记录
            </Link>
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-800">
              {WINDOWS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setWindowDays(days)}
                  className={`min-h-8 rounded-md px-3 text-sm font-medium ${
                    windowDays === days
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {days}天
                </button>
              ))}
            </div>
          </div>

          {loading && (
            <div className="flex min-h-64 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-800">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
              {error}
            </div>
          )}

          {!loading && !error && review && (
            <>
              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="font-mono text-sm text-blue-700 dark:text-blue-300">
                      {batch.batch_id}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <span>{batch.action || '-'}</span>
                      <span>操作人：{batch.operator_name || '-'}</span>
                      <span>分配时间：{formatDateTime(batch.assigned_at, true)}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      统计窗口：{formatDateTime(batch.window_start, true)} 至{' '}
                      {formatDateTime(batch.window_end, true)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                    当前窗口 {batch.window_days || windowDays} 天
                  </div>
                </div>
              </section>

              {alerts.length > 0 && (
                <section className="grid gap-2">
                  {alerts.map((alert) => (
                    <div
                      key={`${alert.type}-${alert.title}`}
                      className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-medium">{alert.title}</div>
                        <div className="text-xs opacity-90">{alert.detail}</div>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="已分配" value={funnel.assigned} icon={Users} />
                <Metric
                  label="已拨打"
                  value={funnel.dialed}
                  hint={pct(funnel.dial_rate)}
                  icon={PhoneCall}
                />
                <Metric
                  label="有效处理"
                  value={funnel.effective_handled}
                  hint={pct(funnel.effective_handle_rate)}
                  icon={CheckCircle2}
                />
                <Metric
                  label="已报名"
                  value={funnel.enrolled}
                  hint={pct(funnel.enrollment_rate)}
                  icon={CheckCircle2}
                />
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  处理漏斗
                </h2>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  {[
                    ['已分配', funnel.assigned, 100],
                    ['已拨打', funnel.dialed, funnel.dial_rate],
                    ['有效处理', funnel.effective_handled, funnel.effective_handle_rate],
                    ['已报名', funnel.enrolled, funnel.enrollment_rate],
                  ].map(([label, value, rate]) => (
                    <div key={label}>
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span>{label}</span>
                        <span>{pct(rate)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                        <div
                          className="h-full rounded-full bg-blue-600"
                          style={{ width: `${Math.min(Number(rate || 0), 100)}%` }}
                        />
                      </div>
                      <div className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                        {fmt(value)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100">
                  坐席拆分
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
                      <tr>
                        <th className="px-3 py-2 text-left">坐席</th>
                        <th className="px-3 py-2 text-right">分配</th>
                        <th className="px-3 py-2 text-right">拨打</th>
                        <th className="px-3 py-2 text-right">有效处理</th>
                        <th className="px-3 py-2 text-right">报名</th>
                        <th className="px-3 py-2 text-right">未处理</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {agents.map((agent) => (
                        <tr key={agent.agent_id ?? 'unknown'}>
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                            {agent.agent_name}
                          </td>
                          <td className="px-3 py-2 text-right">{fmt(agent.assigned)}</td>
                          <td className="px-3 py-2">
                            <RateCell count={agent.dialed} rate={agent.dial_rate} />
                          </td>
                          <td className="px-3 py-2">
                            <RateCell
                              count={agent.effective_handled}
                              rate={agent.effective_handle_rate}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <RateCell count={agent.enrolled} rate={agent.enrollment_rate} />
                          </td>
                          <td className="px-3 py-2 text-right">{fmt(agent.unhandled)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    未处理名单
                  </h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {fmt(unhandledStudents.length)} 条
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
                      <tr>
                        <th className="px-3 py-2 text-left">学生</th>
                        <th className="px-3 py-2 text-left">学校/地区</th>
                        <th className="px-3 py-2 text-left">坐席</th>
                        <th className="px-3 py-2 text-left">状态</th>
                        <th className="px-3 py-2 text-left">拨打</th>
                        <th className="px-3 py-2 text-left">有效处理</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {unhandledStudents.map((student) => (
                        <tr key={student.student_id}>
                          <td className="px-3 py-2">
                            <Link
                              className="font-medium text-blue-700 hover:underline dark:text-blue-300"
                              to={`/admin/leads/${student.student_id}`}
                            >
                              {student.student_name}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                            {student.school_name || '-'} / {student.region || '-'}
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                            {student.agent_name || '-'}
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                            {student.status || '-'}
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                            {student.dialed ? '已拨打' : '未拨打'}
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                            {student.effective_handled ? '已处理' : '未处理'}
                          </td>
                        </tr>
                      ))}
                      {unhandledStudents.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                            该窗口内暂无未处理线索
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </AdminLayout>
  );
}
