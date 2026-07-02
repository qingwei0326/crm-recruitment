import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  Loader2,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react';
import api from '../../api';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { formatDateTime, getApiErrorMessage } from '../../utils';
import { useToast } from '../../components/Toast';
import { QueueRow } from './AdminWorkflowComponents';

function dataList(res) {
  const data = res?.data?.data;
  if (Array.isArray(data)) return data;
  return data?.list || [];
}

function normalizeQueue(value) {
  if (value === 'follow') return 'follow_up';
  if (value === 'visit') return 'campus_visit';
  return value || 'all';
}

function EmptyState({ text }) {
  return <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">{text}</div>;
}

function toneFor(item) {
  if (item.priority === 'high') return 'red';
  if (item.priority === 'low') return 'gray';
  if (item.queue === 'campus_visit') return 'blue';
  if (item.queue === 'settlement') return item.status === '争议' ? 'red' : 'amber';
  if (item.queue === 'help') return 'red';
  return 'amber';
}

function compactParts(parts) {
  return parts.filter((part) => part !== undefined && part !== null && part !== '');
}

export default function AdminWorkCenter() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [savingKey, setSavingKey] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = normalizeQueue(searchParams.get('queue'));
  const closeSidebar = () => setSidebarOpen(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admissions/work-items', {
        params: { queue: 'all', page_size: 100 },
      });
      setItems(dataList(res));
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [queue]);

  const completeHelp = async (studentId) => {
    const key = `help-${studentId}`;
    setSavingKey(key);
    try {
      await api.put(`/students/${studentId}`, { need_help: false });
      setItems((prev) => prev.filter((item) => !(item.kind === 'help' && item.student_id === studentId)));
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
      setItems((prev) => prev.filter((item) => !(item.kind === 'follow_up' && item.source_id === followUpId)));
      toast?.success('已完成回访');
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSavingKey('');
    }
  };

  const queueTabs = useMemo(() => ([
    { key: 'all', label: '全部', count: items.length },
    { key: 'home_visit', label: '家访', count: items.filter((item) => item.queue === 'home_visit').length },
    { key: 'campus_visit', label: '到校', count: items.filter((item) => item.queue === 'campus_visit').length },
    { key: 'follow_up', label: '回访', count: items.filter((item) => item.queue === 'follow_up').length },
    { key: 'settlement', label: '结算', count: items.filter((item) => item.queue === 'settlement').length },
    { key: 'help', label: '求助', count: items.filter((item) => item.queue === 'help').length },
  ]), [items]);
  const visibleItems = queue === 'all' ? items : items.filter((item) => item.queue === queue);

  const actionFor = (item) => {
    if (item.kind === 'help') {
      return (
        <button
          type="button"
          onClick={() => completeHelp(item.student_id)}
          disabled={savingKey === `help-${item.student_id}`}
          className="inline-flex min-h-9 items-center gap-1.5 px-3 rounded-lg bg-orange-600 text-white text-sm disabled:opacity-50"
        >
          {savingKey === `help-${item.student_id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          已处理求助
        </button>
      );
    }
    if (item.kind === 'follow_up') {
      return (
        <button
          type="button"
          onClick={() => completeFollowUp(item.source_id)}
          disabled={savingKey === `follow-${item.source_id}`}
          className="inline-flex min-h-9 items-center gap-1.5 px-3 rounded-lg bg-amber-600 text-white text-sm disabled:opacity-50"
        >
          {savingKey === `follow-${item.source_id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          完成回访
        </button>
      );
    }
    return null;
  };

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
                  家访、到校、回访、结算和求助统一进入待办，优先处理高优先级和超期事项。
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

          <section className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {queueTabs.find((tab) => tab.key === queue)?.label || '全部'}待办
              </h2>
              <span className="text-xs text-gray-500">{visibleItems.length}</span>
            </div>
            {loading ? (
              <EmptyState text="加载中..." />
            ) : visibleItems.length === 0 ? (
              <EmptyState text="暂无待办" />
            ) : (
              <div className="space-y-2 p-3">
                {visibleItems.map((item) => (
                  <QueueRow
                    key={item.id}
                    title={item.title || item.student_name || `待办 #${item.source_id}`}
                    meta={item.reason || item.status || '-'}
                    detailParts={compactParts([
                      item.agent_name || '未知坐席',
                      item.region,
                      item.school_name,
                      formatDateTime(item.due_at),
                      item.status,
                    ])}
                    tone={toneFor(item)}
                    to={item.target_url}
                    action={actionFor(item)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
