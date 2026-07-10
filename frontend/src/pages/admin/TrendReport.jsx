import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import {
  ADMIN_OPERATION_PERMISSIONS,
  canPerformAdminOperation,
} from '../../adminPermissions';
import {
  buildTrendCsv,
  getActiveTrendAgents,
  getCstCalendarRange,
  normalizeTrendData,
  validateTrendRange,
} from './trendReportUtils';
import {
  Sun,
  Moon,
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

const AGENT_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
];

function hasPositiveValue(rows, getValue) {
  return rows.some((row) => Number(getValue(row) || 0) > 0);
}

export default function TrendReport({ embedded = false }) {
  const { dark, toggle } = useTheme();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('month'); // week | month | custom
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hiddenAgentKeys, setHiddenAgentKeys] = useState([]);
  const canExportReport = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.reportExport);

  const fetchTrend = (params = {}) => {
    setLoading(true);
    api
      .get('/stats/trend', { params })
      .then((res) => {
        setTrendData(res.data.data);
        setHiddenAgentKeys([]);
      })
      .catch((error) => {
        const message =
          error?.response?.data?.detail ||
          error?.response?.data?.msg ||
          '数据加载失败';
        toast?.error(message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTrend();
  }, []);

  const handleRangeChange = (r) => {
    setRange(r);
    if (r === 'week' || r === 'month') {
      fetchTrend(getCstCalendarRange(r));
    }
  };

  const handleCustom = () => {
    const message = validateTrendRange(startDate, endDate);
    if (message) {
      toast?.error(message);
      return;
    }
    setRange('custom');
    fetchTrend({ start_date: startDate, end_date: endDate });
  };

  const normalizedTrend = useMemo(
    () => normalizeTrendData(trendData || {}),
    [trendData],
  );
  const visibleAgents = useMemo(
    () => getActiveTrendAgents(normalizedTrend.daily, normalizedTrend.agents),
    [normalizedTrend],
  );
  const chartData = normalizedTrend.daily;
  const visibleMainSeries = useMemo(
    () => MAIN_SERIES.filter((series) => hasPositiveValue(chartData, (row) => row[series.key])),
    [chartData],
  );

  const agentColor = (agent, index) => {
    const numericId = Number(agent.id);
    const hasNumericId = agent.id !== null && agent.id !== '' && Number.isFinite(numericId);
    const colorIndex = hasNumericId
      ? Math.abs(numericId) % AGENT_COLORS.length
      : index % AGENT_COLORS.length;
    return AGENT_COLORS[colorIndex];
  };

  const toggleAgent = (key) => {
    setHiddenAgentKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  const exportCsv = () => {
    if (!canExportReport || !normalizedTrend.daily.length) return;
    const csv = buildTrendCsv(normalizedTrend.daily, visibleAgents);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `趋势报表_${normalizedTrend.end || getCstCalendarRange('month').end_date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const closeSidebar = () => setSidebarOpen(false);

  const content = (
        <div className={`${embedded ? '' : 'p-4 lg:p-6'} max-w-6xl mx-auto space-y-6`}>
          {embedded && canExportReport && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={exportCsv}
                disabled={!normalizedTrend.daily.length}
                className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> 导出
              </button>
            </div>
          )}
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
              aria-label="开始日期"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
            />
            <span className="text-gray-500">至</span>
            <input
              type="date"
              aria-label="结束日期"
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
              {visibleAgents.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">
                    各话务员每日呼出量对比
                  </h3>
                  <ResponsiveContainer width="100%" height={isMobile ? 250 : 350}>
                    <LineChart data={normalizedTrend.daily}>
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
                      {visibleAgents
                        .filter((agent) => !hiddenAgentKeys.includes(agent.key))
                        .map((agent) => (
                          <Line
                            key={agent.key}
                            type="monotone"
                            dataKey={agent.seriesKey}
                            stroke={agentColor(agent, visibleAgents.indexOf(agent))}
                            name={agent.name}
                            strokeWidth={2}
                            dot={{ r: 1 }}
                          />
                        ))}
                    </LineChart>
                  </ResponsiveContainer>
                  <div
                    aria-label="话务员曲线"
                    className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2"
                  >
                    {visibleAgents.map((agent, index) => {
                      const checked = !hiddenAgentKeys.includes(agent.key);
                      return (
                        <label
                          key={agent.key}
                          className="flex cursor-pointer items-center gap-1.5 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAgent(agent.key)}
                            className="sr-only"
                          />
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: agentColor(agent, index) }}
                          />
                          <span className={checked ? '' : 'text-gray-400 line-through'}>
                            {agent.name}
                          </span>
                        </label>
                      );
                    })}
                    {hiddenAgentKeys.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setHiddenAgentKeys([])}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        全部显示
                      </button>
                    )}
                  </div>
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
                        {visibleAgents.map((agent) => (
                          <th key={agent.key} className="px-3 py-2 font-medium text-center text-xs">
                            {agent.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-gray-700">
                      {normalizedTrend.daily.map((d) => (
                        <tr key={d.date} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{d.date}</td>
                          <td className="px-4 py-2 text-center font-medium text-blue-600">
                            {d.calls}
                          </td>
                          <td className="px-4 py-2 text-center font-medium text-green-600">
                            {d.enrolled}
                          </td>
                          {visibleAgents.map((agent) => (
                            <td key={agent.key} className="px-3 py-2 text-center text-gray-500">
                              {d[agent.seriesKey] || 0}
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
  );

  if (embedded) return content;

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <PageHeader title="趋势报表" isMobile={isMobile} onMenuClick={() => setSidebarOpen(true)}>
          {canExportReport && (
            <button
              type="button"
              onClick={exportCsv}
              disabled={!normalizedTrend.daily.length}
              className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> 导出
            </button>
          )}
          {isMobile && (
            <button
              type="button"
              onClick={toggle}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label={dark ? '亮色模式' : '暗色模式'}
            >
              {dark ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-gray-500" />
              )}
            </button>
          )}
        </PageHeader>
        {content}
      </main>
    </AdminLayout>
  );
}
