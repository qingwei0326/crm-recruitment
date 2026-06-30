import { useState, useEffect } from 'react';
import useLazyLoad from '../../hooks/useLazyLoad';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import {
  Trophy,
  Medal,
  TrendingUp,
  TrendingDown,
  MapPin,
  Home,
  Calendar,
  BarChart3,
  Sun,
  Moon,
  Loader2,
  AlertTriangle,
  Download,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import HeatmapChart from './HeatmapChart';

/** Skeleton placeholder shown while a chart section has not scrolled into view. */
function ChartSkeleton({ height = 260 }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight: height }}>
      <Loader2 className="w-6 h-6 animate-spin text-gray-300 dark:text-gray-600" />
      <span className="text-xs text-gray-400 dark:text-gray-500">加载图表中...</span>
    </div>
  );
}

/**
 * Lazy wrapper that defers rendering its children until the container
 * scrolls into the viewport (with a 200px margin).
 * Once visible, the children are kept mounted.
 */
function LazyChart({ children, height = 260 }) {
  const { ref, visible } = useLazyLoad({ rootMargin: '200px' });
  return (
    <div ref={ref}>
      {visible ? children : <ChartSkeleton height={height} />}
    </div>
  );
}

const rankColors = [
  'bg-amber-400 text-amber-900',
  'bg-gray-300 text-gray-700',
  'bg-amber-600 text-amber-100',
];

export default function Report({ embedded = false }) {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [ranking, setRanking] = useState([]);
  const [visits, setVisits] = useState(null);
  const [substageData, setSubstageData] = useState(null);
  const [heatmapData, setHeatmapData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/stats/agent-ranking'),
      api.get('/visits?page_size=100'),
      api.get('/stats/enrollment-substage-distribution'),
      api.get('/stats/heatmap'),
    ])
      .then(([rRes, vRes, sRes, hRes]) => {
        setRanking(rRes.data.data?.ranking || []);
        setVisits(vRes.data.data?.list || []);
        setSubstageData(sRes.data.data || null);
        setHeatmapData(hRes.data.data || null);
      })
      .catch(() => { toast?.error('数据加载失败'); })
      .finally(() => setLoading(false));
  }, []);

  // Split visits by type
  const campusVisits = (visits || []).filter((v) => v.visit_type === '来校参观');
  const homeVisits = (visits || []).filter((v) => v.visit_type === '家访');

  const closeSidebar = () => setSidebarOpen(false);

  const exportRanking = () => {
    if (!ranking.length) return;
    // CSV 字段转义：话务员姓名等自由文本可能含逗号，不转义会列错位
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['排名', '话务员', '总线索', '已联系', 'A级', '已报名', '转化率', '报名率', 'A→报名', '到访', '参观', '家访', '本月呼出'];
    const rows = ranking.map((a, i) => [
      i + 1, a.name, a.total_leads, a.contacted, a.a_count, a.enrolled,
      a.conversion_rate + '%', a.enroll_rate + '%', a.a_to_enroll + '%',
      a.total_visits, a.campus_visits, a.home_visits, a.month_calls,
    ]);
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `话务员业绩排行_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const content = (
        <div className={`${embedded ? '' : 'p-4 lg:p-6'} max-w-6xl mx-auto space-y-6`}>
          {/* ── Section 0: 报名后生命周期分布 + 流失率 ── */}
          {substageData && (
            <LazyChart height={340}>
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
                <div className="px-4 lg:px-6 py-4 border-b dark:border-gray-700 flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-red-500" />
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">报名后生命周期</h3>
                </div>
                <div className="p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-4 border dark:border-gray-700">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">总报名数</div>
                      <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                        {substageData.total_enrolled}
                      </div>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-700">
                      <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 mb-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        报名后流失率
                      </div>
                      <div className="text-4xl font-bold text-red-600 dark:text-red-400">
                        {substageData.churn_rate}%
                      </div>
                      <div className="text-xs text-red-500 dark:text-red-300 mt-1">
                        已流失 {substageData.churned} 人 / 共 {substageData.total_enrolled} 人
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      报名后各阶段分布
                    </div>
                    {(() => {
                      const COLORS = {
                        定金待缴: '#f59e0b',
                        全款待缴: '#3b82f6',
                        已缴全款: '#10b981',
                        入学注册: '#22c55e',
                        流失: '#ef4444',
                        未设置: '#9ca3af',
                      };
                      const data = Object.entries(substageData.distribution || {})
                        .filter(([, v]) => v > 0)
                        .map(([name, value]) => ({ name, value }));
                      if (data.length === 0) {
                        return (
                          <div className="text-sm text-gray-400 py-10 text-center">暂无数据</div>
                        );
                      }
                      return (
                        <ResponsiveContainer width="100%" height={isMobile ? 220 : 260}>
                          <PieChart>
                            <Pie
                              data={data}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={isMobile ? 45 : 60}
                              outerRadius={isMobile ? 75 : 95}
                              label={({ name, value }) => `${name} ${value}`}
                            >
                              {data.map((entry) => (
                                <Cell key={entry.name} fill={COLORS[entry.name] || '#9ca3af'} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: dark ? '#1f2937' : '#fff',
                                border: `1px solid ${dark ? '#374151' : '#e5e7eb'}`,
                                borderRadius: 8,
                                fontSize: 12,
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </LazyChart>
          )}

          {/* ── Section 1: Agent ranking ── */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
            <div className="px-4 lg:px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" />
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">话务员业绩排行</h3>
              </div>
              <button
                onClick={exportRanking}
                disabled={!ranking.length}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" /> 导出
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-left text-gray-600 dark:text-gray-400">
                    <th className="px-3 py-3 w-10 text-center">#</th>
                    <th className="px-3 py-3 font-medium">话务员</th>
                    <th className="px-2 py-3 font-medium text-center">总线索</th>
                    <th className="px-2 py-3 font-medium text-center">已联系</th>
                    <th className="px-2 py-3 font-medium text-center">A级</th>
                    <th className="px-2 py-3 font-medium text-center">已报名</th>
                    <th className="px-2 py-3 font-medium text-center">转化率</th>
                    <th className="px-2 py-3 font-medium text-center">报名率</th>
                    <th className="px-2 py-3 font-medium text-center">A→报名</th>
                    <th className="px-2 py-3 font-medium text-center">到访</th>
                    <th className="px-2 py-3 font-medium text-center">参观</th>
                    <th className="px-2 py-3 font-medium text-center">家访</th>
                    <th className="px-2 py-3 font-medium text-center">本月呼出</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {ranking.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="text-center py-10 text-gray-400">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    ranking.map((a, i) => (
                      <tr
                        key={a.id}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${!a.is_active ? 'opacity-50' : ''}`}
                      >
                        <td className="px-3 py-3 text-center">
                          <span
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${i < 3 ? rankColors[i] : 'text-gray-500'}`}
                          >
                            {i < 3 ? <Medal className="w-3.5 h-3.5" /> : i + 1}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-medium text-gray-900 dark:text-gray-100">
                          {a.name}
                          {!a.is_active && (
                            <span className="text-xs text-red-400 ml-1">(已禁用)</span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-center text-gray-700 dark:text-gray-300">
                          {a.total_leads}
                        </td>
                        <td className="px-2 py-3 text-center text-gray-700 dark:text-gray-300">
                          {a.contacted}
                        </td>
                        <td className="px-2 py-3 text-center">
                          <span
                            className={`font-bold ${a.a_count > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}
                          >
                            {a.a_count}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <span
                            className={`font-bold ${a.enrolled > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}
                          >
                            {a.enrolled}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <span
                            className={`font-semibold ${a.conversion_rate >= 50 ? 'text-green-600' : a.conversion_rate >= 20 ? 'text-amber-600' : 'text-gray-500'}`}
                          >
                            {a.conversion_rate}%
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <span
                            className={`font-semibold ${a.enroll_rate >= 30 ? 'text-green-600' : a.enroll_rate >= 10 ? 'text-amber-600' : 'text-gray-500'}`}
                          >
                            {a.enroll_rate}%
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <span
                            className={`font-semibold ${a.a_to_enroll >= 50 ? 'text-green-600' : a.a_to_enroll >= 20 ? 'text-amber-600' : 'text-gray-500'}`}
                          >
                            {a.a_to_enroll}%
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center text-gray-700 dark:text-gray-300">
                          {a.total_visits}
                        </td>
                        <td className="px-2 py-3 text-center text-green-600 dark:text-green-400">
                          {a.campus_visits}
                        </td>
                        <td className="px-2 py-3 text-center text-amber-600 dark:text-amber-400">
                          {a.home_visits}
                        </td>
                        <td className="px-2 py-3 text-center text-gray-700 dark:text-gray-300">
                          {a.month_calls}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Section 2: Visit schedules ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Campus visits */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
              <div className="px-4 py-4 border-b dark:border-gray-700 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                  <Home className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">来校参观</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {campusVisits.length} 条记录
                  </p>
                </div>
              </div>
              <div className="divide-y dark:divide-gray-700 max-h-96 overflow-y-auto">
                {campusVisits.length === 0 ? (
                  <div className="py-10 text-center text-gray-400 text-sm">暂无来校参观安排</div>
                ) : (
                  campusVisits.map((v) => (
                    <div
                      key={v.id}
                      className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <div className="w-1.5 h-10 rounded-full bg-green-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                            {v.student_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {v.scheduled_date?.split('T')[0]}
                          </span>
                          {v.student_region && <span>{v.student_region}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {v.agent_name}
                        </div>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full mt-0.5 inline-block ${
                            v.status === '已确认'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                              : v.status === '已完成'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : v.status === '已取消'
                                  ? 'bg-red-100 text-red-500 dark:bg-red-900/40 dark:text-red-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                          }`}
                        >
                          {v.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Home visits */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
              <div className="px-4 py-4 border-b dark:border-gray-700 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">家访</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {homeVisits.length} 条记录
                  </p>
                </div>
              </div>
              <div className="divide-y dark:divide-gray-700 max-h-96 overflow-y-auto">
                {homeVisits.length === 0 ? (
                  <div className="py-10 text-center text-gray-400 text-sm">暂无家访安排</div>
                ) : (
                  homeVisits.map((v) => (
                    <div
                      key={v.id}
                      className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <div className="w-1.5 h-10 rounded-full bg-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                            {v.student_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {v.scheduled_date?.split('T')[0]}
                          </span>
                          {v.student_region && <span>{v.student_region}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {v.agent_name}
                        </div>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full mt-0.5 inline-block ${
                            v.status === '已确认'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                              : v.status === '已完成'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : v.status === '已取消'
                                  ? 'bg-red-100 text-red-500 dark:bg-red-900/40 dark:text-red-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                          }`}
                        >
                          {v.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── Section 3: 坐席工作量热力图 ── */}
          {heatmapData && (
            <LazyChart height={320}>
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
                <div className="px-4 lg:px-6 py-4 border-b dark:border-gray-700 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-500" />
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">坐席工作量热力图</h3>
                  <span className="text-xs text-gray-400 ml-2">近30天通话分布</span>
                </div>
                <div className="p-4 lg:p-6">
                  <HeatmapChart data={heatmapData} />
                </div>
              </div>
            </LazyChart>
          )}
        </div>
  );

  if (embedded) return content;

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <PageHeader title="汇总报表" isMobile={isMobile} onMenuClick={() => setSidebarOpen(true)}>
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
