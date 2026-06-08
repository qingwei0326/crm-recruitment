import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import { useToast } from '../../components/Toast';
import {
  ArrowLeft,
  LogOut,
  Menu,
  X,
  Users,
  ListFilter,
  BarChart3,
  Sun,
  Moon,
  LayoutDashboard,
  TrendingUp,
  Download,
  Loader2,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export default function TrendReport() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('month'); // week | month | custom
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchTrend = (params = {}) => {
    setLoading(true);
    api
      .get('/stats/trend', { params })
      .then((res) => {
        setTrendData(res.data.data);
      })
      .catch(() => { toast?.error('数据加载失败'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTrend();
  }, []);

  const handleRangeChange = (r) => {
    setRange(r);
    if (r === 'week') {
      const end = new Date().toISOString().split('T')[0];
      const start = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      fetchTrend({ start_date: start, end_date: end });
    } else if (r === 'month') {
      fetchTrend();
    }
  };

  const handleCustom = () => {
    if (startDate && endDate) fetchTrend({ start_date: startDate, end_date: endDate });
  };

  const exportExcel = () => {
    if (!trendData?.daily) return;
    const rows = [['日期', '呼出量', '报名数']];
    trendData.daily.forEach((d) => rows.push([d.date, d.calls, d.enrolled]));
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `趋势报表_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Collect agent names for lines
  const agentNames = trendData?.daily?.[0]?.agent_calls
    ? Object.keys(trendData.daily[0].agent_calls)
    : [];

  // 周同比：把 7 天前的呼出量偏移到对应日期上
  const chartData = useMemo(() => {
    if (!trendData?.daily) return [];
    const dateMap = {};
    trendData.daily.forEach(d => { dateMap[d.date] = d; });
    return trendData.daily.map(d => {
      const prev = new Date(d.date);
      prev.setDate(prev.getDate() - 7);
      const prevKey = prev.toISOString().split('T')[0];
      return {
        ...d,
        prev_calls: dateMap[prevKey]?.calls ?? null,
      };
    });
  }, [trendData]);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-900">
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-20" onClick={closeSidebar} />
      )}
      <aside
        className={`${isMobile ? 'fixed inset-y-0 left-0 z-30 shadow-2xl transform transition-transform ' + (sidebarOpen ? 'translate-x-0' : '-translate-x-full') : ''} w-60 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-gray-900 dark:text-gray-100">CRM 管理后台</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{user?.name}</div>
            </div>
          </div>
          {isMobile && (
            <button
              onClick={closeSidebar}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          )}
        </div>
        <nav className="p-3 space-y-1">
          <Link
            to="/admin"
            onClick={closeSidebar}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
          >
            <LayoutDashboard className="w-4 h-4" /> 仪表盘
          </Link>
          <Link
            to="/admin/leads"
            onClick={closeSidebar}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
          >
            <ListFilter className="w-4 h-4" /> 学生管理
          </Link>
          <Link
            to="/admin/agents"
            onClick={closeSidebar}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
          >
            <Users className="w-4 h-4" /> 话务员管理
          </Link>
          <Link
            to="/admin/report"
            onClick={closeSidebar}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
          >
            <BarChart3 className="w-4 h-4" /> 汇总报表
          </Link>
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
            <TrendingUp className="w-4 h-4" /> 趋势报表
          </div>
        </nav>
        <div className="mt-auto p-3 border-t dark:border-gray-700 space-y-1">
          <button
            onClick={toggle}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
          >
            {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}{' '}
            {dark ? '亮色模式' : '暗色模式'}
          </button>
          <button
            onClick={logout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <LogOut className="w-4 h-4" /> 退出登录
          </button>
        </div>
      </aside>

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
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">趋势报表</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportExcel}
              disabled={!trendData}
              className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
            >
              <Download className="w-4 h-4" /> 导出
            </button>
            {isMobile && (
              <button
                onClick={toggle}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {dark ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4 text-gray-500" />
                )}
              </button>
            )}
          </div>
        </header>

        <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-6">
          {/* Controls */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 flex flex-wrap gap-3 items-center">
            <button
              onClick={() => handleRangeChange('week')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${range === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
            >
              本周
            </button>
            <button
              onClick={() => handleRangeChange('month')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${range === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
            >
              本月
            </button>
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
              onClick={handleCustom}
              disabled={!startDate || !endDate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              查询
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : trendData ? (
            <>
              {/* Calls + Enrollments chart */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">
                  每日呼出量 & 新增报名
                </h3>
                <ResponsiveContainer width="100%" height={isMobile ? 250 : 350}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#e5e7eb'} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: dark ? '#9ca3af' : '#6b7280' }}
                      tickFormatter={(v) => v.slice(5)}
                    />
                    <YAxis tick={{ fontSize: 12, fill: dark ? '#9ca3af' : '#6b7280' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: dark ? '#1f2937' : '#fff',
                        border: 'none',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="calls"
                      stroke="#3b82f6"
                      name="呼出量"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="enrolled"
                      stroke="#10b981"
                      name="报名数"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="prev_calls"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                      name="上周同期"
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Agent comparison chart */}
              {agentNames.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">
                    各话务员每日呼出量对比
                  </h3>
                  <ResponsiveContainer width="100%" height={isMobile ? 250 : 350}>
                    <LineChart data={trendData.daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#e5e7eb'} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12, fill: dark ? '#9ca3af' : '#6b7280' }}
                        tickFormatter={(v) => v.slice(5)}
                      />
                      <YAxis tick={{ fontSize: 12, fill: dark ? '#9ca3af' : '#6b7280' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: dark ? '#1f2937' : '#fff',
                          border: 'none',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      {agentNames.slice(0, 5).map((name, i) => (
                        <Line
                          key={name}
                          type="monotone"
                          dataKey={`agent_calls.${name}`}
                          stroke={['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i]}
                          name={name}
                          strokeWidth={2}
                          dot={{ r: 1 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Data table */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b dark:border-gray-700">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">数据明细</h3>
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-left text-gray-600 dark:text-gray-400">
                        <th className="px-4 py-2 font-medium">日期</th>
                        <th className="px-4 py-2 font-medium text-center">呼出量</th>
                        <th className="px-4 py-2 font-medium text-center">报名数</th>
                        {agentNames.slice(0, 5).map((n) => (
                          <th key={n} className="px-3 py-2 font-medium text-center text-xs">
                            {n}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-gray-700">
                      {trendData.daily.map((d) => (
                        <tr key={d.date} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{d.date}</td>
                          <td className="px-4 py-2 text-center font-medium text-blue-600">
                            {d.calls}
                          </td>
                          <td className="px-4 py-2 text-center font-medium text-green-600">
                            {d.enrolled}
                          </td>
                          {agentNames.slice(0, 5).map((n) => (
                            <td key={n} className="px-3 py-2 text-center text-gray-500">
                              {d.agent_calls?.[n] || 0}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-20 text-gray-400">加载失败</div>
          )}
        </div>
      </main>
    </div>
  );
}
