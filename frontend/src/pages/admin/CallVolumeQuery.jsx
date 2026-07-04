import { useState, useEffect } from 'react';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { formatDateTime, formatDuration } from '../../utils';
import logger from '../../utils/logger';
import {
  ADMIN_OPERATION_PERMISSIONS,
  canPerformAdminOperation,
} from '../../adminPermissions';
import {
  Download,
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const emptySummary = {
  total_calls: 0,
  recorded_calls: 0,
  unrecorded_calls: 0,
  total_recorded_duration_seconds: 0,
  avg_recorded_duration_seconds: 0,
};

export default function CallVolumeQuery({ embedded = false }) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agents, setAgents] = useState([]);
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(emptySummary);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 50;
  const canExportReport = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.reportExport);

  useEffect(() => {
    api
      .get('/admin/agents')
      .then((r) => {
        const a = r.data.data || [];
        setAgents(a);
        setSelectedAgents(a.map((x) => x.id));
      })
      .catch((e) => logger.error('加载话务员列表失败:', e));
  }, []);

  const fetchLogs = (p = 1) => {
    // 话务员已加载、却一个都没选 → 明确返回空，而不是发空 agent_ids
    // （后端把空 agent_ids 当作「不过滤」会返回全部，造成「取消全选反而显示所有人」）。
    if (agents.length > 0 && selectedAgents.length === 0) {
      setLogs([]);
      setTotal(0);
      setSummary(emptySummary);
      return;
    }
    setLoading(true);
    const params = {
      agent_ids: selectedAgents.join(','),
      page: p,
      page_size: pageSize,
    };
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    api
      .get('/operation-logs/call-volume', { params })
      .then((res) => {
        const data = res.data.data || {};
        setLogs(data.list || []);
        setTotal(data.total || 0);
        setSummary({ ...emptySummary, ...(data.summary || {}) });
      })
      .catch(() => { toast?.error('数据加载失败'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs(1);
    setPage(1);
  }, []);

  const toggleAgent = (id) => {
    setSelectedAgents((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  // CSV 字段转义：含逗号/引号/换行时用双引号包裹并转义内部引号。
  const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportExcel = async () => {
    if (!canExportReport) return;
    if (agents.length > 0 && selectedAgents.length === 0) {
      toast?.error('请至少选择一个话务员');
      return;
    }
    // 导出全部筛选结果（逐页拉取），而非仅当前页 50 条
    const allLogs = [];
    const EXPORT_PAGE_SIZE = 200; // 后端 page_size 上限
    try {
      for (let p = 1; ; p += 1) {
        const res = await api.get('/operation-logs/call-volume', {
          params: {
            start_date: startDate,
            end_date: endDate,
            agent_ids: selectedAgents.join(','),
            page: p,
            page_size: EXPORT_PAGE_SIZE,
          },
        });
        const list = res.data.data?.list || [];
        allLogs.push(...list);
        const t = res.data.data?.total || 0;
        if (list.length === 0 || allLogs.length >= t) break;
      }
    } catch {
      toast?.error('导出失败');
      return;
    }
    const rows = [['序号', '话务员', '学生', '学生ID', '通话时长', '拨号时间']];
    allLogs.forEach((l) =>
      rows.push([
        l.seq,
        l.agent_name || l.operator_name,
        l.student_name,
        l.student_id,
        formatDuration(l.duration_seconds),
        formatDateTime(l.dialed_at || l.created_at, true),
      ]),
    );
    const csv = '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `通电量_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const closeSidebar = () => setSidebarOpen(false);
  const summaryItems = [
    { label: '总拨号', value: summary.total_calls || 0 },
    { label: '有效记录', value: summary.recorded_calls || 0 },
    { label: '未记录', value: summary.unrecorded_calls || 0 },
    {
      label: '平均有效时长',
      value: formatDuration(summary.avg_recorded_duration_seconds),
    },
  ];

  const content = (
        <div className={`${embedded ? '' : 'p-4 lg:p-6'} max-w-6xl mx-auto space-y-4`}>
          {embedded && canExportReport && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={exportExcel}
                className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                导出
              </button>
            </div>
          )}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
            <div className="flex flex-wrap gap-3 items-center">
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <span className="shrink-0">开始日期</span>
                <input
                  aria-label="开始日期"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <span className="text-gray-500">至</span>
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <span className="shrink-0">结束日期</span>
                <input
                  aria-label="结束日期"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                />
              </label>
              <button
                onClick={() => {
                  fetchLogs(1);
                  setPage(1);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-1"
              >
                <Search className="w-4 h-4" />
                查询
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => toggleAgent(a.id)}
                  aria-pressed={selectedAgents.includes(a.id)}
                  className={`min-h-9 min-w-9 text-xs px-3 py-2 rounded-full ${selectedAgents.includes(a.id) ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {summaryItems.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="text-xs text-gray-500 dark:text-gray-400">{item.label}</div>
                <div className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-left text-gray-600 dark:text-gray-400">
                    <th className="px-3 py-3 w-12">序号</th>
                    <th className="px-3 py-3">话务员</th>
                    <th className="px-3 py-3">学生</th>
                    <th className="px-3 py-3">学生ID</th>
                    <th className="px-3 py-3">通话时长</th>
                    <th className="px-3 py-3">拨号时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-gray-400">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    logs.map((l) => (
                      <tr key={l.seq} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-3 py-2 text-center">{l.seq}</td>
                        <td className="px-3 py-2 font-medium">{l.agent_name || l.operator_name}</td>
                        <td className="px-3 py-2">{l.student_name || '-'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{l.student_id || '-'}</td>
                        <td className="px-3 py-2 text-xs">{formatDuration(l.duration_seconds)}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {formatDateTime(l.dialed_at || l.created_at, true)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t dark:border-gray-700 flex items-center justify-between text-sm">
              <span className="text-gray-500">共 {total} 条</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  aria-label="上一页"
                  onClick={() => {
                    const p = page - 1;
                    setPage(p);
                    fetchLogs(p);
                  }}
                  className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span>{page}</span>
                <button
                  disabled={page * pageSize >= total}
                  aria-label="下一页"
                  onClick={() => {
                    const p = page + 1;
                    setPage(p);
                    fetchLogs(p);
                  }}
                  className="inline-flex min-w-9 min-h-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
  );

  if (embedded) return content;

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="通电量查询"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        >
          {canExportReport && (
            <button
              type="button"
              onClick={exportExcel}
              className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              导出
            </button>
          )}
        </PageHeader>
        {content}
      </main>
    </AdminLayout>
  );
}
