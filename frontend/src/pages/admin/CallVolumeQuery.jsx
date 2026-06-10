import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import { useToast } from '../../components/Toast';
import { formatDateTime } from '../../utils';
import {
  LogOut,
  Menu,
  X,
  Users,
  ListFilter,
  BarChart3,
  TrendingUp,
  Sun,
  Moon,
  LayoutDashboard,
  Download,
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Phone,
} from 'lucide-react';

export default function CallVolumeQuery() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agents, setAgents] = useState([]);
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 50;

  useEffect(() => {
    api
      .get('/admin/agents')
      .then((r) => {
        const a = r.data.data || [];
        setAgents(a);
        setSelectedAgents(a.map((x) => x.id));
      })
      .catch(() => {});
  }, []);

  const fetchLogs = (p = 1) => {
    // 话务员已加载、却一个都没选 → 明确返回空，而不是发空 agent_ids
    // （后端把空 agent_ids 当作「不过滤」会返回全部，造成「取消全选反而显示所有人」）。
    if (agents.length > 0 && selectedAgents.length === 0) {
      setLogs([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    const params = {
      start_date: startDate,
      end_date: endDate,
      agent_ids: selectedAgents.join(','),
      page: p,
      page_size: pageSize,
    };
    api
      .get('/operation-logs/call-volume', { params })
      .then((res) => {
        setLogs(res.data.data?.list || []);
        setTotal(res.data.data?.total || 0);
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

  // CSV 字段转义：含逗号/引号/换行时用双引号包裹并转义内部引号，
  // 否则自由文本（操作内容/备注）里的逗号会把整行列错位。
  const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportExcel = async () => {
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
    const rows = [
      ['序号', '话务员', '操作', '档案号', '操作内容', '原状态', '新状态', '备注内容', '时间'],
    ];
    allLogs.forEach((l) =>
      rows.push([
        l.seq,
        l.operator_name,
        l.action,
        l.case_no,
        l.content,
        l.old_status,
        l.new_status,
        l.note_content,
        formatDateTime(l.created_at, true),
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

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>

      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button className="p-2 -ml-2" onClick={() => setSidebarOpen(true)}>
                <Menu className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">通电量查询</h2>
          </div>
          <button
            onClick={exportExcel}
            className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            导出
          </button>
        </header>

        <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
              />
              <span className="text-gray-500">至</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
              />
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
                  className={`text-xs px-3 py-1.5 rounded-full ${selectedAgents.includes(a.id) ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-left text-gray-600 dark:text-gray-400">
                    <th className="px-3 py-3 w-12">序号</th>
                    <th className="px-3 py-3">话务员</th>
                    <th className="px-3 py-3">操作</th>
                    <th className="px-3 py-3">档案号</th>
                    <th className="px-3 py-3">操作内容</th>
                    <th className="px-3 py-3">原状态</th>
                    <th className="px-3 py-3">新状态</th>
                    <th className="px-3 py-3">备注内容</th>
                    <th className="px-3 py-3">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="text-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-gray-400">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    logs.map((l) => (
                      <tr key={l.seq} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-3 py-2 text-center">{l.seq}</td>
                        <td className="px-3 py-2 font-medium">{l.operator_name}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded-full ${l.action === '写备注' ? 'bg-blue-100 text-blue-700' : l.action === '修改状态' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                          >
                            {l.action}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{l.case_no?.slice(0, 8)}</td>
                        <td className="px-3 py-2 text-xs max-w-[150px] truncate">{l.content}</td>
                        <td className="px-3 py-2 text-xs">{l.old_status}</td>
                        <td className="px-3 py-2 text-xs">{l.new_status}</td>
                        <td className="px-3 py-2 text-xs max-w-[150px] truncate">
                          {l.note_content}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {formatDateTime(l.created_at, true)}
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
                  onClick={() => {
                    const p = page - 1;
                    setPage(p);
                    fetchLogs(p);
                  }}
                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span>{page}</span>
                <button
                  disabled={page * pageSize >= total}
                  onClick={() => {
                    const p = page + 1;
                    setPage(p);
                    fetchLogs(p);
                  }}
                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </AdminLayout>
  );
}
