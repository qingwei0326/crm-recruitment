import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Loader2,
  RotateCcw,
  Search,
} from 'lucide-react';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import useIsMobile from '../../hooks/useIsMobile';
import { formatDateTime } from '../../utils';
import logger from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import {
  ADMIN_OPERATION_PERMISSIONS,
  canPerformAdminOperation,
} from '../../adminPermissions';

const PAGE_SIZE = 50;

const actionTone = {
  登录: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200',
  学校分配: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
  学校分配汇总: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
  区域分配: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
  区域分配汇总: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
  自动分配汇总: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
  批量分配: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
  多学校分发: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
  多学校分发汇总: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
  分配回滚: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200',
  分配回滚汇总: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200',
  删除线索: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200',
  数据清理: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200',
  线索回收: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
  Excel导入: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200',
};

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function AuditLogs() {
  const isMobile = useIsMobile();
  const toast = useToast();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agents, setAgents] = useState([]);
  const [actions, setActions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [rollbackModal, setRollbackModal] = useState(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const canExportAuditLogs = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.auditExport);
  const canRollbackAssignments = canPerformAdminOperation(
    user,
    ADMIN_OPERATION_PERMISSIONS.assignmentRollback,
  );
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    operatorId: '',
    action: searchParams.get('action') || '',
    category: searchParams.get('category') || '',
    batchId: searchParams.get('batch_id') || '',
    q: searchParams.get('q') || '',
  });

  useEffect(() => {
    api
      .get('/admin/users')
      .then((res) => {
        setAgents(res.data.data || []);
      })
      .catch((e) => logger.error('加载账号列表失败:', e));
  }, []);

  const paramsFor = (targetPage, targetPageSize = PAGE_SIZE, sourceFilters = filters) => {
    const params = {
      page: targetPage,
      page_size: targetPageSize,
    };
    if (sourceFilters.startDate) params.start_date = sourceFilters.startDate;
    if (sourceFilters.endDate) params.end_date = sourceFilters.endDate;
    if (sourceFilters.operatorId) params.operator_id = sourceFilters.operatorId;
    if (sourceFilters.action) params.action = sourceFilters.action;
    if (sourceFilters.category) params.category = sourceFilters.category;
    if (sourceFilters.batchId) params.batch_id = sourceFilters.batchId;
    if (sourceFilters.q.trim()) params.q = sourceFilters.q.trim();
    return params;
  };

  const fetchLogs = (targetPage = 1, sourceFilters = filters) => {
    setLoading(true);
    api
      .get('/operation-logs', { params: paramsFor(targetPage, PAGE_SIZE, sourceFilters) })
      .then((res) => {
        const data = res.data.data || {};
        setLogs(data.list || []);
        setTotal(data.total || 0);
        setActions(data.actions || []);
        setCategories(data.categories || []);
      })
      .catch(() => {
        toast?.error('操作记录加载失败');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs(1);
  }, []);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);
  const actionOptions = useMemo(
    () => actions.filter((item) => item.action).map((item) => item.action),
    [actions],
  );

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const runSearch = () => {
    setPage(1);
    fetchLogs(1);
  };

  const applyCategory = (categoryName) => {
    const nextCategory = filters.category === categoryName ? '' : categoryName;
    const nextFilters = { ...filters, category: nextCategory };
    setFilters(nextFilters);
    setPage(1);
    fetchLogs(1, nextFilters);
  };

  const exportCsv = async () => {
    if (!canExportAuditLogs) return;
    const rows = [['序号', '时间', '操作人', '动作', '批次号', '学生', '学校', '内容', '案号']];
    const allRows = [];
    const exportPageSize = 200;
    try {
      for (let currentPage = 1; ; currentPage += 1) {
        const res = await api.get('/operation-logs', {
          params: paramsFor(currentPage, exportPageSize),
        });
        const data = res.data.data || {};
        const list = data.list || [];
        allRows.push(...list);
        if (list.length === 0 || allRows.length >= (data.total || 0)) break;
      }
    } catch {
      toast?.error('导出失败');
      return;
    }
    allRows.forEach((row) => {
      rows.push([
        row.seq,
        formatDateTime(row.created_at, true),
        row.operator_name || '-',
        row.action || '-',
        row.batch_id || '-',
        row.student_name || row.student_id || '-',
        row.student_school_name || '-',
        row.content || row.note_content || '-',
        row.case_no || '-',
      ]);
    });
    const csv = `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `操作记录_${filters.startDate || '全部'}_${filters.endDate || '全部'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openRollbackPreview = async (batchId) => {
    if (!canRollbackAssignments) return;
    if (!batchId) return;
    setRollbackLoading(true);
    try {
      const res = await api.get(`/admin/assignment-rollbacks/${encodeURIComponent(batchId)}`);
      if (res.data.code === 0) {
        setRollbackModal(res.data.data);
      } else {
        toast?.error(res.data.msg || '回滚预览失败');
      }
    } catch {
      toast?.error('回滚预览失败');
    } finally {
      setRollbackLoading(false);
    }
  };

  const confirmRollback = async () => {
    if (!canRollbackAssignments) return;
    if (!rollbackModal?.batch_id || rollbackLoading) return;
    setRollbackLoading(true);
    try {
      const res = await api.post(
        `/admin/assignment-rollbacks/${encodeURIComponent(rollbackModal.batch_id)}`,
        { confirm: true },
      );
      if (res.data.code === 0) {
        const data = res.data.data || {};
        toast?.success?.(`已回滚 ${data.rolled_back_count || 0} 条，跳过 ${data.skipped_count || 0} 条`);
        setRollbackModal(null);
        fetchLogs(page);
      } else {
        toast?.error(res.data.msg || '回滚失败');
      }
    } catch {
      toast?.error('回滚失败');
    } finally {
      setRollbackLoading(false);
    }
  };

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="操作记录"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        >
          {canExportAuditLogs && (
            <button
              type="button"
              onClick={exportCsv}
              className="gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white"
            >
              <Download className="h-4 w-4" />
              导出
            </button>
          )}
        </PageHeader>

        <div className="mx-auto max-w-7xl space-y-4 p-4 lg:p-6">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1.5fr_2fr_auto]">
              <label className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                <span>开始日期</span>
                <input
                  aria-label="开始日期"
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => updateFilter('startDate', e.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <label className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                <span>结束日期</span>
                <input
                  aria-label="结束日期"
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => updateFilter('endDate', e.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <label className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                <span>操作人</span>
                <select
                  aria-label="操作人"
                  value={filters.operatorId}
                  onChange={(e) => updateFilter('operatorId', e.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="">全部</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                <span>动作</span>
                <select
                  aria-label="动作"
                  value={filters.action}
                  onChange={(e) => updateFilter('action', e.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="">全部</option>
                  {actionOptions.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                <span>关键字</span>
                <input
                  aria-label="关键字"
                  type="search"
                  value={filters.q}
                  onChange={(e) => updateFilter('q', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runSearch();
                  }}
                  placeholder="姓名、学校、内容、案号"
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <label className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                <span>批次号</span>
                <input
                  aria-label="批次号"
                  type="search"
                  value={filters.batchId}
                  onChange={(e) => updateFilter('batchId', e.target.value)}
                  placeholder="phone-dedupe..."
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={runSearch}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white lg:w-auto"
                >
                  <Search className="h-4 w-4" />
                  查询
                </button>
              </div>
            </div>
          </div>

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {categories.map((item) => (
                <button
                  key={item.category}
                  type="button"
                  onClick={() => applyCategory(item.category)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    filters.category === item.category
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
                  }`}
                >
                  {item.category} {item.count}
                </button>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                <ClipboardList className="h-4 w-4 text-blue-600" />
                操作流水
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">共 {total} 条</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                  <tr>
                    <th className="w-14 px-3 py-3">序号</th>
                    <th className="min-w-40 px-3 py-3">时间</th>
                    <th className="min-w-24 px-3 py-3">操作人</th>
                    <th className="min-w-28 px-3 py-3">动作</th>
                    <th className="min-w-40 px-3 py-3">关联学生</th>
                    <th className="min-w-72 px-3 py-3">内容</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-400">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-400">
                        暂无操作记录
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/60">
                        <td className="px-3 py-3 text-center text-xs text-gray-500">{log.seq}</td>
                        <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                          {formatDateTime(log.created_at, true)}
                        </td>
                        <td className="px-3 py-3 font-medium text-gray-800 dark:text-gray-100">
                          {log.operator_name || '-'}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                                actionTone[log.action]
                                || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                              }`}
                            >
                              {log.action}
                            </span>
                            {log.category && (
                              <span className="inline-flex rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                                {log.category}
                              </span>
                            )}
                            {log.batch_id && (
                              <span className="inline-flex rounded-full bg-amber-50 px-2 py-1 font-mono text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                                {log.batch_id}
                              </span>
                            )}
                            {log.can_rollback_assignment && canRollbackAssignments && (
                              <button
                                type="button"
                                onClick={() => openRollbackPreview(log.batch_id)}
                                className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-200"
                              >
                                <RotateCcw className="h-3 w-3" />
                                回滚预览
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-gray-800 dark:text-gray-100">
                            {log.student_name || (log.student_id ? `ID ${log.student_id}` : '-')}
                          </div>
                          {log.student_school_name && (
                            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                              {log.student_school_name}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="max-w-xl whitespace-pre-wrap break-words text-gray-700 dark:text-gray-200">
                            {log.content || log.note_content || '-'}
                          </div>
                          {log.case_no && (
                            <div className="mt-1 font-mono text-xs text-gray-400">
                              {log.case_no}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm dark:border-gray-700">
              <span className="text-gray-500 dark:text-gray-400">
                第 {page} / {totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  aria-label="上一页"
                  onClick={() => {
                    const nextPage = page - 1;
                    setPage(nextPage);
                    fetchLogs(nextPage);
                  }}
                  className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  aria-label="下一页"
                  onClick={() => {
                    const nextPage = page + 1;
                    setPage(nextPage);
                    fetchLogs(nextPage);
                  }}
                  className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
        {rollbackModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl dark:bg-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    分配批次回滚预览
                  </h3>
                  <div className="mt-1 font-mono text-xs text-gray-500">
                    {rollbackModal.batch_id}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setRollbackModal(null)}
                  className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  关闭
                </button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {rollbackModal.total_logs || 0}
                  </div>
                  <div className="text-xs text-gray-500">批次记录</div>
                </div>
                <div className="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
                  <div className="text-lg font-bold text-green-700 dark:text-green-200">
                    {rollbackModal.rollbackable_count || 0}
                  </div>
                  <div className="text-xs text-green-700 dark:text-green-200">可回滚</div>
                </div>
                <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
                  <div className="text-lg font-bold text-amber-700 dark:text-amber-200">
                    {rollbackModal.skipped_count || 0}
                  </div>
                  <div className="text-xs text-amber-700 dark:text-amber-200">跳过</div>
                </div>
              </div>
              <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border dark:border-gray-700">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900/40">
                    <tr>
                      <th className="px-3 py-2">学生</th>
                      <th className="px-3 py-2">学校</th>
                      <th className="px-3 py-2">回滚</th>
                      <th className="px-3 py-2">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {(rollbackModal.items || []).map((item) => (
                      <tr key={`${item.log_id}-${item.student_id}`}>
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                          {item.student_name || `ID ${item.student_id}`}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{item.school_name || '-'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-500">
                          {item.new_assigned_to ?? '未分配'} → {item.old_assigned_to ?? '未分配'}
                        </td>
                        <td className="px-3 py-2">
                          {item.status === 'ok' ? (
                            <span className="rounded-full bg-green-50 px-2 py-1 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-200">
                              可回滚
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                              {item.reason || '跳过'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRollbackModal(null)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={confirmRollback}
                  disabled={rollbackLoading || !rollbackModal.rollbackable_count}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {rollbackLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  确认回滚
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </AdminLayout>
  );
}
