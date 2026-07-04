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
  CheckCircle2,
  Clock3,
  ExternalLink,
} from 'lucide-react';
import HelpModal from '../../components/HelpModal';
import FunnelChart from './FunnelChart';
import { stageLabel, STAGES } from '../../labels';
import { ActionCard } from './AdminWorkflowComponents';
import { buildDashboardActions, dashboardLeadUrls } from './adminWorkflow';
import AdminMobileDash from './AdminMobileDash';
import {
  ADMIN_OPERATION_PERMISSIONS,
  ADMIN_PAGE_PERMISSIONS,
  canAccessAdminPage,
  canPerformAdminOperation,
} from '../../adminPermissions';

const dailyOpsToneClasses = {
  high: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200',
  medium: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200',
  low: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
};

function DailyOpsPanel({
  dailyOps,
  loading,
  savingKey,
  canReview,
  onMark,
}) {
  const summary = dailyOps?.summary || {};
  const activeItems = (dailyOps?.items || []).filter((item) => item.count > 0);
  return (
    <section className="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
      <div className="border-b dark:border-gray-700 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              今日运营闭环
            </h2>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              每天把高风险事项处理完；确认闭环只写操作记录，不改变业务状态。
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
              <div className="text-base font-bold text-gray-900 dark:text-gray-100">
                {loading ? '-' : summary.total_items || 0}
              </div>
              <div className="text-gray-500">今日事项</div>
            </div>
            <div className="rounded-lg bg-green-50 px-3 py-2 text-green-700 dark:bg-green-900/20 dark:text-green-300">
              <div className="text-base font-bold">{loading ? '-' : summary.closed_items || 0}</div>
              <div>已闭环</div>
            </div>
            <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <div className="text-base font-bold">{loading ? '-' : summary.high_pending_items || 0}</div>
              <div>高风险剩余</div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 md:col-span-2 xl:col-span-4">
            加载运营闭环...
          </div>
        ) : activeItems.length === 0 ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300 md:col-span-2 xl:col-span-4">
            <div className="font-medium">今日运营闭环暂无待处理事项</div>
            <div className="mt-1 text-xs opacity-80">可以继续查看报表和分配情况。</div>
          </div>
        ) : (
          activeItems.map((item) => (
            <div
              key={item.key}
              className={`rounded-lg border p-3 ${dailyOpsToneClasses[item.severity] || dailyOpsToneClasses.low}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{item.title}</div>
                  <div className="mt-1 text-xs leading-5 opacity-80">{item.detail}</div>
                </div>
                <span className="shrink-0 rounded-full bg-white/75 px-2 py-1 text-sm font-bold dark:bg-black/20">
                  {item.count}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <Clock3 className="h-3.5 w-3.5" />
                <span>{item.status}</span>
                {item.reviewed_by && <span className="truncate opacity-70">· {item.reviewed_by}</span>}
              </div>
              {item.owners?.length > 0 && (
                <div className="mt-3 space-y-1.5 rounded-lg bg-white/65 p-2 text-xs dark:bg-black/15">
                  {item.owners.slice(0, 3).map((owner) => (
                    <Link
                      key={`${item.key}-${owner.agent_id ?? 'none'}`}
                      to={owner.to || item.to || '/admin/work-center'}
                      className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-white/80 dark:hover:bg-black/20"
                    >
                      <span className="min-w-0 truncate">{owner.agent_name}</span>
                      <span className="shrink-0 opacity-80">
                        {owner.count}项
                        {owner.max_age_days > 0 ? ` · ${owner.max_age_days}天` : ''}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  to={item.to || '/admin/work-center'}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white/80 px-2.5 text-xs font-medium hover:bg-white dark:bg-black/20 dark:hover:bg-black/30"
                >
                  查看
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                {canReview && !item.is_closed && (
                  <>
                    <button
                      type="button"
                      disabled={savingKey === `${item.key}:已处理`}
                      onClick={() => onMark(item, '已处理')}
                      className="inline-flex min-h-8 items-center rounded-lg bg-blue-600 px-2.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {savingKey === `${item.key}:已处理` ? '确认中...' : '确认处理'}
                    </button>
                    <button
                      type="button"
                      disabled={savingKey === `${item.key}:暂缓`}
                      onClick={() => onMark(item, '暂缓')}
                      className="inline-flex min-h-8 items-center rounded-lg bg-white/80 px-2.5 text-xs font-medium hover:bg-white disabled:opacity-60 dark:bg-black/20 dark:hover:bg-black/30"
                    >
                      暂缓
                    </button>
                    <button
                      type="button"
                      disabled={savingKey === `${item.key}:明日继续跟进`}
                      onClick={() => onMark(item, '明日继续跟进')}
                      className="inline-flex min-h-8 items-center rounded-lg bg-white/80 px-2.5 text-xs font-medium hover:bg-white disabled:opacity-60 dark:bg-black/20 dark:hover:bg-black/30"
                    >
                      明日继续
                    </button>
                    <button
                      type="button"
                      disabled={savingKey === `${item.key}:无需处理`}
                      onClick={() => onMark(item, '无需处理')}
                      className="inline-flex min-h-8 items-center rounded-lg bg-white/80 px-2.5 text-xs font-medium hover:bg-white disabled:opacity-60 dark:bg-black/20 dark:hover:bg-black/30"
                    >
                      无需处理
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function AdminDesktopDash({ isMobile }) {
  const { dark, toggle } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stats, setStats] = useState([]);
  const [summary, setSummary] = useState(null);
  const [visitSummary, setVisitSummary] = useState(null);
  const [stageStats, setStageStats] = useState({});
  const [enrollmentData, setEnrollmentData] = useState(null);
  const [funnelData, setFunnelData] = useState(null);
  const [quality, setQuality] = useState(null);
  const [dailyOps, setDailyOps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dailyOpsSavingKey, setDailyOpsSavingKey] = useState('');
  const [notifyFails, setNotifyFails] = useState(0);
  const [actionData, setActionData] = useState({
    helpRequests: [],
    followUps: [],
    visits: [],
    scoreItems: [],
    staleAItems: [],
    unassignedCount: 0,
  });
  const canViewScorePreview = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.scorePreview);
  const canViewReportCenter = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.reportCenter);
  const canViewAuditLogs = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.auditLogs);
  const canViewWorkCenter = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.workCenter);
  const canViewLeadsManage = canAccessAdminPage(user, ADMIN_PAGE_PERMISSIONS.leadsManage);
  const canReviewDailyOps = canPerformAdminOperation(
    user,
    ADMIN_OPERATION_PERMISSIONS.governanceReview,
  );

  useEffect(() => {
    Promise.all([
      api.get('/admin/daily-ops'),
      api.get('/stats/sources'),
      api.get('/stats/dashboard-summary'),
      api.get('/visits/summary'),
      api.get('/stats/stages'),
      api.get('/students/enrolled?page_size=1'),
      api.get('/stats/funnel'),
      api.get('/students', { params: { need_help: '1', page_size: 100 } }),
      api.get('/follow-ups', { params: { is_completed: false, page_size: 100 } }),
      api.get('/visits', { params: { page_size: 100 } }),
      canViewScorePreview
        ? api.get('/admin/agent-score-preview', { params: { daily_call_target: 30 } })
        : Promise.resolve({ data: { data: { items: [] } } }),
      api.get('/admin/stale-a', { params: { days: 3 } }),
      api.get('/admin/data-quality'),
    ])
      .then(([
        dailyOpsRes,
        sRes,
        summaryRes,
        vRes,
        stRes,
        eRes,
        fRes,
        helpRes,
        followRes,
        visitRes,
        scoreRes,
        staleARes,
        qualityRes,
    ]) => {
        setDailyOps(dailyOpsRes.data.data || null);
        setStats(sRes.data.data || []);
        setSummary(summaryRes.data.data || null);
        setVisitSummary(vRes.data.data || null);
        setStageStats(stRes.data.data || {});
        setEnrollmentData(eRes.data.data || null);
        setFunnelData(fRes.data.data || null);
        setQuality(qualityRes.data.data || null);
        setActionData({
          helpRequests: helpRes.data.data?.list || [],
          followUps: followRes.data.data?.list || [],
          visits: visitRes.data.data?.list || [],
          scoreItems: scoreRes.data.data?.items || [],
          staleAItems: staleARes.data.data || [],
          unassignedCount:
            summaryRes.data.data?.available_unassigned ??
            qualityRes.data.data?.students?.unassigned_active ??
            0,
        });
      })
      .catch(() => { toast?.error('数据加载失败'); })
      .finally(() => setLoading(false));
  }, [canViewScorePreview]);

  const refreshDailyOps = useCallback(() => {
    return api.get('/admin/daily-ops').then((res) => {
      setDailyOps(res.data.data || null);
    });
  }, []);

  const markDailyOpsItem = useCallback(
    async (item, status) => {
      if (!canReviewDailyOps || !item?.key) return;
      const savingKey = `${item.key}:${status}`;
      setDailyOpsSavingKey(savingKey);
      try {
        await api.post('/admin/daily-ops/reviews', {
          key: item.key,
          status,
          count: item.count || 0,
        });
        toast?.success('已记录运营闭环');
        await refreshDailyOps();
      } catch (error) {
        toast?.error('记录运营闭环失败');
      } finally {
        setDailyOpsSavingKey('');
      }
    },
    [canReviewDailyOps, refreshDailyOps, toast],
  );

  useEffect(() => {
    if (!canViewAuditLogs) {
      setNotifyFails(0);
      return;
    }
    api.get('/admin/operation-logs?action=通知失败&days=7')
      .then(r => setNotifyFails(r.data.data?.total ?? 0))
      .catch(() => {});
  }, [canViewAuditLogs]);

  const actionItems = useMemo(
    () =>
      buildDashboardActions({
        helpCount: actionData.helpRequests.length,
        followUps: actionData.followUps,
        visits: actionData.visits,
        scoreItems: actionData.scoreItems,
        missingPhoneCount: quality?.students?.missing_phone_tasks ?? 0,
        staleAItems: actionData.staleAItems,
        notifyFails,
        canViewSystemSettings: Boolean(user?.is_super_admin),
        canViewWorkCenter,
        canViewLeadsManage,
        canViewScorePreview,
        canViewReportCenter,
      }),
    [
      actionData,
      notifyFails,
      quality?.students?.missing_phone_tasks,
      user?.is_super_admin,
      canViewWorkCenter,
      canViewLeadsManage,
      canViewScorePreview,
      canViewReportCenter,
    ],
  );

  const recordedCalls = quality?.calls?.today?.recorded_calls ?? 0;
  const availableUnassigned =
    summary?.available_unassigned ?? quality?.students?.unassigned_active ?? 0;
  const todayA = summary?.today_a ?? 0;
  const todayCalls = summary?.today_calls ?? quality?.calls?.today?.total_calls ?? 0;

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
          <DailyOpsPanel
            dailyOps={dailyOps}
            loading={loading}
            savingKey={dailyOpsSavingKey}
            canReview={canReviewDailyOps}
            onMark={markDailyOpsItem}
          />

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
              {!loading && actionItems.length === 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300 md:col-span-2 xl:col-span-4">
                  <div className="font-medium">今日暂无待处理风险项</div>
                  <div className="mt-1 text-xs opacity-80">可继续查看下方关键指标和报表趋势。</div>
                </div>
              )}
            </div>
          </section>

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            {[
              {
                label: '可分配有效线索',
                value: availableUnassigned,
                icon: Users,
                color: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
                link: dashboardLeadUrls.availableUnassigned,
                hidden: !canViewLeadsManage,
              },
              {
                label: '今日新增 A',
                value: todayA,
                icon: TrendingUp,
                color: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400',
                link: dashboardLeadUrls.todayA,
                hidden: !canViewLeadsManage,
              },
              {
                label: '今日呼出',
                value: todayCalls,
                icon: BarChart3,
                color: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
                link: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '',
              },
              {
                label: '有效通话',
                value: recordedCalls,
                icon: PhoneCall,
                color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
                link: canViewReportCenter ? '/admin/report-center?tab=call-volume' : '',
              },
            ]
              .filter((s) => !s.hidden)
              .map((s, i) => (
              <Link
                to={s.link || '#'}
                key={i}
                onClick={(event) => {
                  if (!s.link) event.preventDefault();
                }}
                className={`bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 lg:p-5 shadow-sm transition ${
                  s.link
                    ? 'hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 cursor-pointer'
                    : 'cursor-default'
                }`}
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
                      className={`flex-1 text-center transition-opacity ${
                        canViewLeadsManage ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
                      }`}
                      onClick={() => {
                        if (canViewLeadsManage) {
                          navigate(`/admin/leads?stage=${encodeURIComponent(s)}`);
                        }
                      }}
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
      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        role={user?.is_super_admin ? 'super_admin' : 'admin'}
      />
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
