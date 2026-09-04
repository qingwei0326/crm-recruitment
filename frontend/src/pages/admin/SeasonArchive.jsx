import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  DatabaseBackup,
  Download,
  Loader2,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import { adminPageMainClass } from '../../components/admin/AdminPagePrimitives';
import PageHeader from '../../components/PageHeader';
import { getApiErrorMessage } from '../../utils';

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';

const countLabels = [
  ['students', '学生'],
  ['calls', '通话'],
  ['notes', '备注'],
  ['follow_ups', '回访'],
  ['visits', '到访'],
  ['home_visit_tasks', '家访任务'],
  ['campus_visit_tasks', '到校任务'],
  ['enrollment_records', '报名记录'],
  ['dial_logs', '拨号记录'],
  ['student_assignments', '分配历史'],
  ['work_items', '工作项'],
  ['handover_items', '交接项'],
  ['personal_group_memberships', '个人分组'],
  ['operation_logs', '学生操作记录'],
];

function Status({ ok, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300'
          : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300'
      }`}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

function formatBytes(value) {
  if (!Number.isFinite(Number(value))) return '-';
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function SeasonArchive() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [reason, setReason] = useState('本招生季结束，已完成导出和数据库备份校验');

  const closeSidebar = () => setSidebarOpen(false);
  const loadPreview = async () => {
    setLoading(true);
    try {
      const response = await api.get('/admin/season-archive/preview');
      setPreview(response.data.data || null);
    } catch (error) {
      setMessage({ type: 'error', text: getApiErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview();
  }, []);

  const prepare = async () => {
    setPreparing(true);
    setMessage(null);
    try {
      const response = await api.post('/admin/season-archive/prepare');
      if (response.data.code !== 0) throw new Error(response.data.msg || '归档准备失败');
      setPrepared(response.data.data || null);
      setConfirmText('');
      setMessage({ type: 'success', text: '导出包已生成，数据库备份已通过校验。' });
      await loadPreview();
    } catch (error) {
      setMessage({ type: 'error', text: getApiErrorMessage(error) });
    } finally {
      setPreparing(false);
    }
  };

  const cleanup = async () => {
    if (!prepared || confirmText.trim() !== prepared.confirm_text || !reason.trim()) return;
    setCleaning(true);
    setMessage(null);
    try {
      const response = await api.post('/admin/season-archive/cleanup', {
        archive_id: prepared.archive_id,
        export_name: prepared.name,
        backup_name: prepared.backup_name,
        confirm_text: confirmText.trim(),
        reason: reason.trim(),
      });
      if (response.data.code !== 0) throw new Error(response.data.msg || '清理失败');
      setPrepared(null);
      setConfirmText('');
      setMessage({ type: 'success', text: '招生季数据已清理，清理汇总已写入操作记录。' });
      await loadPreview();
    } catch (error) {
      setMessage({ type: 'error', text: getApiErrorMessage(error) });
    } finally {
      setCleaning(false);
    }
  };

  const counts = useMemo(() => prepared?.counts || preview?.counts || {}, [prepared, preview]);
  const backup = prepared?.backup || null;
  const canCleanup = Boolean(
    prepared &&
      confirmText.trim() === prepared.confirm_text &&
      reason.trim() &&
      !cleaning,
  );

  return (
    <AdminLayout
      isMobile={isMobile}
      sidebarOpen={sidebarOpen}
      onClose={closeSidebar}
      compactSidebar={!isMobile}
    >
      <main className={adminPageMainClass}>
        <PageHeader
          title="招生季归档"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        >
          <button
            type="button"
            onClick={toggle}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-gray-300 dark:hover:bg-gray-700"
            aria-label={dark ? '切换亮色模式' : '切换暗色模式'}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </PageHeader>

        <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
          <section className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 dark:bg-amber-900/20">
            <div className="flex items-start gap-3 text-amber-900 dark:text-amber-200">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 className="font-semibold">超级管理员操作</h2>
                <p className="mt-1 text-sm leading-6">
                  清理只会在导出包、数据库备份和学生数据指纹全部匹配时执行。执行后学生及其招生业务记录不可从系统恢复，请先下载导出包和备份。
                </p>
              </div>
            </div>
          </section>

          {message?.text && (
            <div
              role="status"
              className={`border px-4 py-3 text-sm ${
                message.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300'
              }`}
            >
              {message.text}
            </div>
          )}

          <section className="rounded-lg border border-slate-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <Archive className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
                <h2 className="font-semibold text-slate-900 dark:text-gray-100">当前招生季数据</h2>
              </div>
              <button
                type="button"
                onClick={loadPreview}
                disabled={loading}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                刷新统计
              </button>
            </div>
            <div className="p-4">
              {loading && !preview ? (
                <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> 正在读取数据统计
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                    {countLabels.map(([key, label]) => (
                      <div key={key} className="border border-slate-200 px-3 py-3 dark:border-gray-700">
                        <div className="text-xs text-slate-500 dark:text-gray-400">{label}</div>
                        <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-gray-100">
                          {counts[key] ?? 0}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-gray-300">
                    <span>学生数据指纹：{preview?.student_id_hash?.slice(0, 16) || '-'}…</span>
                    {preview?.latest_backup ? (
                      <Status ok>已有最新备份：{preview.latest_backup.name}</Status>
                    ) : (
                      <Status ok={false}>当前没有可用备份</Status>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-slate-200 px-4 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <DatabaseBackup className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
                <h2 className="font-semibold text-slate-900 dark:text-gray-100">生成归档包</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-gray-400">
                生成一份招生季 CSV 导出包，并同步生成、校验当前数据库备份。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 p-4">
              <button
                type="button"
                onClick={prepare}
                disabled={preparing}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                {preparing ? '生成中' : '生成导出并校验备份'}
              </button>
              {prepared && (
                <Status ok={backup?.valid === true}>归档批次已准备</Status>
              )}
            </div>
            {prepared && (
              <div className="grid gap-3 border-t border-slate-200 p-4 text-sm dark:border-gray-700 sm:grid-cols-2">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500 dark:text-gray-400">导出文件</div>
                  <a
                    href={`/api/admin/season-archive/exports/${encodeURIComponent(prepared.name)}`}
                    download
                    className="mt-1 inline-flex max-w-full items-center gap-2 truncate text-indigo-600 hover:underline dark:text-indigo-300"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    {prepared.name} · {formatBytes(prepared.size)}
                  </a>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-gray-400">数据库备份</div>
                  <div className="mt-1 break-all text-slate-700 dark:text-gray-200">
                    {prepared.backup_name} · {formatBytes(backup?.size)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-emerald-600 dark:text-emerald-300">
                      {backup?.integrity_check === 'ok' ? 'SQLite 完整性校验通过' : '备份文件已校验'}
                    </span>
                    <a
                      href={`/api/admin/backups/${encodeURIComponent(prepared.backup_name)}`}
                      download
                      className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-300"
                    >
                      <Download className="h-3.5 w-3.5" /> 下载数据库备份
                    </a>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-red-200 bg-white dark:border-red-900/60 dark:bg-gray-800">
            <div className="border-b border-red-100 px-4 py-4 dark:border-red-900/50">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                <Trash2 className="h-5 w-5" />
                <h2 className="font-semibold">执行招生季清理</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-gray-400">
                只有完成上一步准备后才能执行。输入确认词并填写原因，清理汇总会保留在操作记录中。
              </p>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <label htmlFor="season-cleanup-reason" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-gray-200">
                  清理原因
                </label>
                <textarea
                  id="season-cleanup-reason"
                  className={`${inputCls} min-h-20 resize-y`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  disabled={!prepared || cleaning}
                />
              </div>
              <div className="max-w-md">
                <label htmlFor="season-cleanup-confirm" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-gray-200">
                  输入确认词：{prepared?.confirm_text || '生成归档后显示'}
                </label>
                <input
                  id="season-cleanup-confirm"
                  className={inputCls}
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder={prepared?.confirm_text || '请先生成归档'}
                  disabled={!prepared || cleaning}
                />
              </div>
              <button
                type="button"
                onClick={cleanup}
                disabled={!canCleanup}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cleaning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {cleaning ? '清理中' : '确认并清理本招生季'}
              </button>
            </div>
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
