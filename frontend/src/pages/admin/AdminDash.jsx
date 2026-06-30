import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import {
  Users,
  PhoneCall,
  TrendingUp,
  BarChart3,
  Sun,
  Moon,
  MapPin,
  Home,
  Calendar,
  GraduationCap,
  HelpCircle,
  AlertTriangle,
} from 'lucide-react';
import HelpModal from '../../components/HelpModal';
import FunnelChart from './FunnelChart';
import { stageLabel, STAGES } from '../../labels';
import { ActionCard } from './AdminWorkflowComponents';
import { buildDashboardActions } from './adminWorkflow';
import AdminMobileDash from './AdminMobileDash';

function AdminDesktopDash({ isMobile }) {
  const { dark, toggle } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stats, setStats] = useState([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [todayCalls, setTodayCalls] = useState(0);
  const [visitSummary, setVisitSummary] = useState(null);
  const [stageStats, setStageStats] = useState({});
  const [enrollmentData, setEnrollmentData] = useState(null);
  const [funnelData, setFunnelData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notifyFails, setNotifyFails] = useState(0);
  const [actionData, setActionData] = useState({
    helpRequests: [],
    followUps: [],
    visits: [],
    scoreItems: [],
    unassignedCount: 0,
  });

  useEffect(() => {
    Promise.all([
      api.get('/stats/sources'),
      api.get('/students?page_size=1'),
      api.get('/admin/agents'),
      api.get('/visits/summary'),
      api.get('/stats/stages'),
      api.get('/students/enrolled?page_size=1'),
      api.get('/stats/funnel'),
      api.get('/students', { params: { need_help: '1', page_size: 100 } }),
      api.get('/follow-ups', { params: { is_completed: false, page_size: 100 } }),
      api.get('/visits', { params: { page_size: 100 } }),
      api.get('/admin/agent-score-preview', { params: { daily_call_target: 30 } }),
      api.get('/students', { params: { assignment: 'unassigned', page_size: 1 } }),
    ])
      .then(([sRes, lRes, aRes, vRes, stRes, eRes, fRes, helpRes, followRes, visitRes, scoreRes, unassignedRes]) => {
        setStats(sRes.data.data || []);
        setTotalStudents(lRes.data.data?.total || 0);
        const agents = aRes.data.data || [];
        setTodayCalls(agents.reduce((s, a) => s + (a.today_calls || 0), 0));
        setVisitSummary(vRes.data.data || null);
        setStageStats(stRes.data.data || {});
        setEnrollmentData(eRes.data.data || null);
        setFunnelData(fRes.data.data || null);
        setActionData({
          helpRequests: helpRes.data.data?.list || [],
          followUps: followRes.data.data?.list || [],
          visits: visitRes.data.data?.list || [],
          scoreItems: scoreRes.data.data?.items || [],
          unassignedCount: unassignedRes.data.data?.total || 0,
        });
      })
      .catch(() => { toast?.error('数据加载失败'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.get('/admin/operation-logs?action=通知失败&days=7')
      .then(r => setNotifyFails(r.data.data?.total ?? 0))
      .catch(() => {});
  }, []);

  const totalA = useMemo(() => stats.reduce((s, i) => s + (i.a_count || 0), 0), [stats]);
  const contacted = useMemo(() => stats.reduce((s, i) => s + (i.contacted || 0), 0), [stats]);
  const actionItems = useMemo(
    () =>
      buildDashboardActions({
        helpCount: actionData.helpRequests.length,
        followUps: actionData.followUps,
        visits: actionData.visits,
        scoreItems: actionData.scoreItems,
        unassignedCount: actionData.unassignedCount,
        aIntentCount: totalA,
        notifyFails,
        canViewSystemSettings: Boolean(user?.is_super_admin),
      }),
    [actionData, notifyFails, totalA, user?.is_super_admin],
  );

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="仪表盘"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        >
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            aria-label="使用说明"
            title="使用说明"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
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
        <div className="p-4 lg:p-6 space-y-6 max-w-6xl mx-auto">
          <section className="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
            <div className="border-b dark:border-gray-700 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                今日待办
              </h2>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                先处理风险项，再看报表数据；每张卡片都能直达对应页面。
              </div>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              {actionItems.map((item) => (
                <ActionCard key={item.key} item={loading ? { ...item, value: '-' } : item} />
              ))}
            </div>
          </section>

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            {[
              {
                label: '学生总数',
                value: totalStudents,
                icon: Users,
                color: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
                link: '/admin/leads',
              },
              {
                label: '已联系',
                value: contacted,
                icon: PhoneCall,
                color: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400',
                link: '/admin/leads?status=已联系',
              },
              {
                label: 'A 级意向',
                value: totalA,
                icon: TrendingUp,
                color: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
                link: '/admin/leads?intent=A',
              },
              {
                label: '今日呼出',
                value: todayCalls,
                icon: BarChart3,
                color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
                link: '/admin/report-center?tab=call-volume',
              },
            ].map((s, i) => (
              <Link
                to={s.link}
                key={i}
                className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 lg:p-5 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.color}`}
                  >
                    <s.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {loading ? '-' : s.value}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {notifyFails > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              近 7 天有 {notifyFails} 条推送通知失败
              {user?.is_super_admin ? '，请检查 PushPlus Token 配置' : '，请联系超级管理员处理'}
            </div>
          )}

          {/* Stage distribution */}
          {Object.keys(stageStats).length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
              <div className="px-4 py-4 border-b dark:border-gray-700">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">跟进阶段分布</h3>
              </div>
              <div className="p-4 flex gap-1 items-end">
                {STAGES.map((s) => {
                  const cnt = stageStats[s] || 0;
                  const maxVal = Math.max(...Object.values(stageStats), 1);
                  return (
                    <div
                      key={s}
                      className="flex-1 text-center cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => navigate(`/admin/leads?stage=${encodeURIComponent(s)}`)}
                    >
                      <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                        {cnt}
                      </div>
                      <div
                        className="w-full bg-blue-500 rounded-t hover:bg-blue-600 transition-colors"
                        style={{
                          height: `${Math.max((cnt / maxVal) * 80, 4)}px`,
                          minHeight: '4px',
                        }}
                      />
                      <div className="text-xs text-gray-400 mt-2 truncate">
                        {stageLabel(s).split('').join('​')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Funnel chart */}
          {funnelData && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
              <div className="px-4 py-4 border-b dark:border-gray-700">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> 线索流转漏斗
                </h3>
              </div>
              <div className="p-4">
                <FunnelChart data={funnelData} />
              </div>
            </div>
          )}

          {/* Region conversion table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
            <div className="px-4 lg:px-6 py-4 border-b dark:border-gray-700">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <MapPin className="w-4 h-4" /> 各地域转化率
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-left text-gray-600 dark:text-gray-400">
                    <th className="px-4 py-3 font-medium">地域</th>
                    <th className="px-4 py-3 font-medium text-center">学生总数</th>
                    <th className="px-4 py-3 font-medium text-center">已联系</th>
                    <th className="px-4 py-3 font-medium text-center">A级数</th>
                    <th className="px-4 py-3 font-medium text-center">转化率</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">
                        加载中...
                      </td>
                    </tr>
                  ) : stats.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    stats.map((s, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                          {s.source}
                        </td>
                        <td className="px-4 py-3 text-center">{s.total}</td>
                        <td className="px-4 py-3 text-center">{s.contacted}</td>
                        <td className="px-4 py-3 text-center">{s.a_count}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.conversion_rate >= 50 ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : s.conversion_rate >= 20 ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
                          >
                            {s.conversion_rate}%
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Enrollment summary */}
          {enrollmentData && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
              <div className="px-4 py-4 border-b dark:border-gray-700">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                  <GraduationCap className="w-4 h-4" /> 报名汇总
                </h3>
              </div>
              <div className="p-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {enrollmentData.total}
                  </div>
                  <div className="text-xs text-gray-500">报名总数</div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    ¥{(enrollmentData.total_deposit || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">总定金</div>
                </div>
              </div>
            </div>
          )}

          {/* Visit summary */}
          {visitSummary && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
              <div className="px-4 py-4 border-b dark:border-gray-700">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                  <MapPin className="w-4 h-4" /> 到访汇总
                </h3>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {(visitSummary.by_type?.['来校参观'] || 0) +
                        (visitSummary.by_type?.['家访'] || 0)}
                    </div>
                    <div className="text-xs text-gray-500">到访总数</div>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {visitSummary.by_type?.['来校参观'] || 0}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
                      <Home className="w-3 h-3" />
                      来校参观
                    </div>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-amber-600">
                      {visitSummary.by_type?.['家访'] || 0}
                    </div>
                    <div className="text-xs text-gray-500">
                      <MapPin className="w-3 h-3 inline" />
                      家访
                    </div>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-900/30 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {visitSummary.by_status?.['待确认'] || 0}
                    </div>
                    <div className="text-xs text-gray-500">待确认</div>
                  </div>
                </div>
                {visitSummary.upcoming?.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" /> 近期到访安排
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {visitSummary.upcoming.map((v) => (
                        <div
                          key={v.id}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${v.visit_type === '来校参观' ? 'bg-green-500' : 'bg-amber-500'}`}
                          />
                          <span className="font-medium">{v.student_name}</span>
                          <span className="text-xs text-gray-500">{v.visit_type}</span>
                          <span className="ml-auto text-xs text-gray-400">
                            {v.scheduled_date?.split('T')[0]}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded-full ${v.status === '已确认' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}
                          >
                            {v.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} role="admin" />
    </AdminLayout>
  );
}

export default function AdminDash() {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <AdminMobileDash />;
  }
  return <AdminDesktopDash isMobile={isMobile} />;
}
