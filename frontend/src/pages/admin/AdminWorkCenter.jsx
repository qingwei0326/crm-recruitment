import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  HelpingHand,
  Loader2,
  Moon,
  RefreshCw,
  Sun,
  AlertTriangle,
} from 'lucide-react';
import api from '../../api';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { formatDateTime, getApiErrorMessage } from '../../utils';
import { useToast } from '../../components/Toast';
import { QueueRow } from './AdminWorkflowComponents';
import { daysUntil, isOverdue } from './adminWorkflow';

function dataList(res) {
  const data = res?.data?.data;
  if (Array.isArray(data)) return data;
  return data?.list || [];
}

function EmptyState({ text }) {
  return <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">{text}</div>;
}

function PersonLine({ name, region, agentName }) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{name || '-'}</div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        {region && <span>{region}</span>}
        {agentName && <span>{agentName}</span>}
        {!region && !agentName && <span>-</span>}
      </div>
    </div>
  );
}

export default function AdminWorkCenter() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [helpRequests, setHelpRequests] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [visits, setVisits] = useState([]);
  const [savingKey, setSavingKey] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = searchParams.get('queue') || 'all';
  const closeSidebar = () => setSidebarOpen(false);

  const load = async () => {
    setLoading(true);
    try {
      const [helpRes, followRes, visitRes] = await Promise.all([
        api.get('/students', { params: { need_help: '1', page_size: 100 } }),
        api.get('/follow-ups', { params: { is_completed: false, page_size: 100 } }),
        api.get('/visits', { params: { page_size: 100 } }),
      ]);
      setHelpRequests(dataList(helpRes));
      setFollowUps(dataList(followRes));
      setVisits(dataList(visitRes));
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const completeHelp = async (studentId) => {
    const key = `help-${studentId}`;
    setSavingKey(key);
    try {
      await api.put(`/students/${studentId}`, { need_help: false });
      setHelpRequests((prev) => prev.filter((item) => item.id !== studentId));
      toast?.success('已处理求助');
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSavingKey('');
    }
  };

  const completeFollowUp = async (followUpId) => {
    const key = `follow-${followUpId}`;
    setSavingKey(key);
    try {
      await api.put(`/follow-ups/${followUpId}`, { is_completed: true });
      setFollowUps((prev) => prev.filter((item) => item.id !== followUpId));
      toast?.success('已完成回访');
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSavingKey('');
    }
  };

  const updateVisitStatus = async (visitId, status) => {
    const key = `visit-${visitId}`;
    setSavingKey(key);
    try {
      await api.put(`/visits/${visitId}`, { status });
      setVisits((prev) => prev.map((item) => (item.id === visitId ? { ...item, status } : item)));
      toast?.success('已更新到访');
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSavingKey('');
    }
  };

  const sortedFollowUps = [...followUps].sort((a, b) => {
    const aOverdue = isOverdue(a.follow_up_date) ? 1 : 0;
    const bOverdue = isOverdue(b.follow_up_date) ? 1 : 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;
    return String(a.follow_up_date || '').localeCompare(String(b.follow_up_date || ''));
  });
  const sortedVisits = [...visits].sort((a, b) => {
    const aDays = daysUntil(a.scheduled_date);
    const bDays = daysUntil(b.scheduled_date);
    return (aDays ?? 9999) - (bDays ?? 9999);
  });
  const queueTabs = [
    { key: 'all', label: '全部', count: helpRequests.length + followUps.length + visits.length },
    { key: 'help', label: '求助', count: helpRequests.length },
    { key: 'follow', label: '回访', count: followUps.length },
    { key: 'visit', label: '到访', count: visits.length },
  ];
  const showHelp = queue === 'all' || queue === 'help';
  const showFollow = queue === 'all' || queue === 'follow';
  const showVisit = queue === 'all' || queue === 'visit';

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="工作中心"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          actionsClassName="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            aria-label="刷新工作中心"
          >
            <RefreshCw className={`w-5 h-5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={toggle}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={dark ? '亮色模式' : '暗色模式'}
          >
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
        </PageHeader>

        <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-4">
          <section className="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="lg:mr-auto">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">处理队列</h2>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  逾期回访、求助和今日到访会排在前面，处理完后自动从队列中移除。
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {queueTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSearchParams(tab.key === 'all' ? {} : { queue: tab.key })}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      queue === tab.key
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {tab.label} {tab.count}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
          {showHelp && (
          <section className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <HelpingHand className="w-4 h-4 text-orange-500" />
                求助处理
              </h2>
              <span className="text-xs text-gray-500">{helpRequests.length}</span>
            </div>
            {loading ? (
              <EmptyState text="加载中..." />
            ) : helpRequests.length === 0 ? (
              <EmptyState text="暂无求助" />
            ) : (
              <div className="space-y-2 p-3">
                {helpRequests.map((student) => (
                  <QueueRow
                    key={student.id}
                    title={student.name || `学生 #${student.id}`}
                    meta={student.agent_name || '未分配'}
                    detailParts={[student.region || '未知地区', student.school_name || '未知学校', student.status || '-']}
                    tone="red"
                    to={`/admin/leads/${student.id}`}
                    action={(
                      <button
                        type="button"
                        onClick={() => completeHelp(student.id)}
                        disabled={savingKey === `help-${student.id}`}
                        className="inline-flex min-h-9 items-center gap-1.5 px-3 rounded-lg bg-orange-600 text-white text-sm disabled:opacity-50"
                      >
                        {savingKey === `help-${student.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        已处理求助
                      </button>
                    )}
                  />
                ))}
              </div>
            )}
          </section>
          )}

          {showFollow && (
          <section className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-amber-500" />
                回访管理
              </h2>
              <span className="text-xs text-gray-500">{followUps.length}</span>
            </div>
            {loading ? (
              <EmptyState text="加载中..." />
            ) : followUps.length === 0 ? (
              <EmptyState text="暂无待回访" />
            ) : (
              <div className="space-y-2 p-3">
                {sortedFollowUps.map((item) => (
                  <QueueRow
                    key={item.id}
                    title={item.student_name || `学生 #${item.student_id}`}
                    meta={isOverdue(item.follow_up_date) ? '逾期回访' : '待回访'}
                    detailParts={[item.agent_name || '未知坐席', formatDateTime(item.follow_up_date), item.follow_up_type || '电话']}
                    tone={isOverdue(item.follow_up_date) ? 'red' : 'amber'}
                    to={`/admin/leads/${item.student_id}`}
                    action={(
                      <button
                        type="button"
                        onClick={() => completeFollowUp(item.id)}
                        disabled={savingKey === `follow-${item.id}`}
                        className="inline-flex min-h-9 items-center gap-1.5 px-3 rounded-lg bg-amber-600 text-white text-sm disabled:opacity-50"
                      >
                        {savingKey === `follow-${item.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        完成回访
                      </button>
                    )}
                  />
                ))}
              </div>
            )}
          </section>
          )}

          {showVisit && (
          <section className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-blue-500" />
                到访管理
              </h2>
              <span className="text-xs text-gray-500">{visits.length}</span>
            </div>
            {loading ? (
              <EmptyState text="加载中..." />
            ) : visits.length === 0 ? (
              <EmptyState text="暂无到访" />
            ) : (
              <div className="space-y-2 p-3">
                {sortedVisits.map((item) => (
                  <QueueRow
                    key={item.id}
                    title={item.student_name || `学生 #${item.student_id}`}
                    meta={daysUntil(item.scheduled_date) === 0 ? '今日到访' : item.status || '待确认'}
                    detailParts={[item.agent_name || '未知坐席', item.visit_type || '到访', formatDateTime(item.scheduled_date)]}
                    tone={daysUntil(item.scheduled_date) === 0 ? 'blue' : 'gray'}
                    to={item.student_id ? `/admin/leads/${item.student_id}` : undefined}
                    action={(
                      <button
                        type="button"
                        onClick={() => updateVisitStatus(item.id, '已确认')}
                        disabled={savingKey === `visit-${item.id}` || item.status === '已确认'}
                        className="inline-flex min-h-9 items-center gap-1.5 px-3 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50"
                      >
                        {savingKey === `visit-${item.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        确认到访
                      </button>
                    )}
                  />
                ))}
              </div>
            )}
          </section>
          )}
          </div>
        </div>
      </main>
    </AdminLayout>
  );
}
