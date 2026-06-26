import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
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

const MAIN_SERIES = [
  { key: 'calls', name: '呼出量', stroke: '#3b82f6', strokeWidth: 2, dot: { r: 2 } },
  { key: 'enrolled', name: '报名数', stroke: '#10b981', strokeWidth: 2, dot: { r: 3 } },
  {
    key: 'prev_calls',
    name: '上周同期',
    stroke: '#94a3b8',
    strokeWidth: 1.5,
    strokeDasharray: '4 4',
    dot: false,
    connectNulls: false,
  },
];

const AGENT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function hasPositiveValue(rows, getValue) {
  return rows.some((row) => Number(getValue(row) || 0) > 0);
}

function getActiveAgentNames(rows) {
  const totals = new Map();
  rows.forEach((row) => {
    Object.entries(row.agent_calls || {}).forEach(([name, value]) => {
      totals.set(name, (totals.get(name) || 0) + Number(value || 0));
    });
  });
  return [...totals.entries()].filter(([, total]) => total > 0).map(([name]) => name);
}

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
  const visibleMainSeries = useMemo(
    () => MAIN_SERIES.filter((series) => hasPositiveValue(chartData, (row) => row[series.key])),
    [chartData],
  );
  const visibleAgentNames = useMemo(
    () => getActiveAgentNames(trendData?.daily || []).slice(0, 5),
    [trendData],
  );

  const closeSidebar = () => setSidebarOpen(false);

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
              {visibleMainSeries.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">每日趋势</h3>
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
                      {visibleMainSeries.map((series) => (
                        <Line
                          key={series.key}
                          type="monotone"
                          dataKey={series.key}
                          stroke={series.stroke}
                          name={series.name}
                          strokeWidth={series.strokeWidth}
                          strokeDasharray={series.strokeDasharray}
                          dot={series.dot}
                          connectNulls={series.connectNulls}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Agent comparison chart */}
              {visibleAgentNames.length > 0 && (
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
                      {visibleAgentNames.map((name, i) => (
                        <Line
                          key={name}
                          type="monotone"
                          dataKey={`agent_calls.${name}`}
                          stroke={AGENT_COLORS[i]}
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
                        {visibleAgentNames.map((n) => (
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
                          {visibleAgentNames.map((n) => (
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
    </AdminLayout>
  );
}
