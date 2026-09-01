import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Moon,
  RefreshCw,
  Search,
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

const PAGE_SIZE = 50;

function pageData(res) {
  const data = res?.data?.data;
  const list = Array.isArray(data) ? data : data?.list || [];
  const totalValue = Number(data?.total);
  const pageValue = Number(data?.page);
  const pageSizeValue = Number(data?.page_size);
  const total = Number.isFinite(totalValue) ? totalValue : list.length;
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
  const pageSize = Number.isFinite(pageSizeValue) && pageSizeValue > 0 ? pageSizeValue : PAGE_SIZE;
  return {
    list,
    total,
    page,
    pageSize,
    hasMore: data?.has_more ?? page * pageSize < total,
    queueCounts: data?.queue_counts || {},
    regions: Array.isArray(data?.regions) ? data.regions : [],
  };
}

function normalizeQueue(value) {
  if (value === 'follow') return 'follow_up';
  if (value === 'visit') return 'campus_visit';
  if (value === 'lead' || value === 'initial_contact') return 'lead_contact';
  if (value === 'stale_a') return 'stale-a';
  return value || 'all';
}

function EmptyState({ text }) {
  return <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">{text}</div>;
}

function toneFor(item) {
  if (item.priority === 'high') return 'red';
  if (item.priority === 'low') return 'gray';
  if (item.queue === 'stale-a') return 'red';
  if (item.queue === 'lead_contact') return 'blue';
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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [queueCounts, setQueueCounts] = useState({});
  const [availableRegions, setAvailableRegions] = useState([]);
  const [savingKey, setSavingKey] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = normalizeQueue(searchParams.get('queue'));
  const closeSidebar = () => setSidebarOpen(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { queue, page, page_size: PAGE_SIZE };
      if (searchQuery.trim()) params.q = searchQuery.trim();
      if (regionFilter !== 'all') params.region = regionFilter;
      const payload = pageData(await api.get('/admissions/work-items', { params }));
      setItems(payload.list);
      setTotal(payload.total);
      setHasMore(Boolean(payload.hasMore));
      setQueueCounts(payload.queueCounts);
      setAvailableRegions(payload.regions);
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [page, queue, regionFilter, searchQuery, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const removeItem = (itemQueue, predicate) => {
    setItems((prev) => prev.filter((item) => !predicate(item)));
    setTotal((prev) => Math.max(prev - 1, 0));
    setQueueCounts((prev) => {
      const next = { ...prev };
      if (Number.isFinite(Number(next[itemQueue]))) {
        next[itemQueue] = Math.max(Number(next[itemQueue]) - 1, 0);
      }
      if (Number.isFinite(Number(next.all))) {
        next.all = Math.max(Number(next.all) - 1, 0);
      }
      return next;
    });
  };

  const completeHelp = async (studentId) => {
    const key = `help-${studentId}`;
    setSavingKey(key);
    try {
      await api.put(`/students/${studentId}`, { need_help: false });
      removeItem('help', (item) => item.kind === 'help' && item.student_id === studentId);
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
      removeItem('follow_up', (item) => item.kind === 'follow_up' && item.source_id === followUpId);
      toast?.success('已完成回访');
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSavingKey('');
    }
  };

  const queueTabs = useMemo(() => {
    const countFor = (key) => {
      const value = Number(queueCounts[key]);
      if (Number.isFinite(value)) return value;
      return key === queue ? total : 0;
    };
    return [
      { key: 'all', label: '全部', count: countFor('all') },
      { key: 'lead_contact', label: '待首呼', count: countFor('lead_contact') },
      { key: 'home_visit', label: '家访', count: countFor('home_visit') },
      { key: 'campus_visit', label: '到校', count: countFor('campus_visit') },
      { key: 'follow_up', label: '回访', count: countFor('follow_up') },
      { key: 'settlement', label: '结算', count: countFor('settlement') },
      { key: 'help', label: '求助', count: countFor('help') },
      { key: 'stale-a', label: 'A超时', count: countFor('stale-a') },
    ];
  }, [queue, queueCounts, total]);
  const visibleItems = useMemo(() => {
    let next = queue === 'all' ? items : items.filter((item) => item.queue === queue);
    if (regionFilter !== 'all') {
      next = next.filter((item) => item.region === regionFilter);
    }
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      next = next.filter((item) => [
        item.title,
        item.student_name,
        item.region,
        item.school_name,
        item.agent_name,
        item.reason,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
    }
    return next;
  }, [items, queue, regionFilter, searchQuery]);

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
      <main className="min-w-0 flex-1 bg-slate-100 dark:bg-gray-950">
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

        <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 lg:p-6">
          <section className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 lg:mr-auto">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blue-600" aria-hidden="true" />
                  <h2 className="text-sm font-bold text-gray-950 dark:text-gray-100">管理员处置队列</h2>
                </div>
                <div className="mt-1 max-w-2xl text-xs leading-5 text-gray-500 dark:text-gray-400">
                  待首呼、家访、到校、回访、结算和求助统一进入待办，优先处理高优先级和超期事项。
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-900 dark:text-gray-100">{total}</span>
                <span>项待处理</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <div className="flex min-w-max gap-2">
                {queueTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => {
                      setPage(1);
                      setSearchParams(tab.key === 'all' ? {} : { queue: tab.key });
                    }}
                    className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition ${
                      queue === tab.key
                        ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {tab.label} {tab.count}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-bold text-gray-950 dark:text-gray-100">
                {queueTabs.find((tab) => tab.key === queue)?.label || '全部'}待办
                </h2>
                <p className="mt-0.5 text-[11px] text-gray-400">支持按学生、学校、区域和坐席快速定位</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <label className="relative min-w-0 sm:w-64">
                  <span className="sr-only">搜索待办</span>
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => {
                      setPage(1);
                      setSearchQuery(event.target.value);
                    }}
                    placeholder="搜索学生、学校或坐席"
                    className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                </label>
                {availableRegions.length > 0 && (
                  <label className="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-2.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="sr-only">区域筛选</span>
                    <select
                      value={regionFilter}
                      onChange={(event) => {
                        setPage(1);
                        setRegionFilter(event.target.value);
                      }}
                      aria-label="区域筛选"
                      className="max-w-[120px] bg-transparent font-medium text-gray-700 outline-none dark:text-gray-200"
                    >
                      <option value="all">全部区域</option>
                      {availableRegions.map((region) => <option key={region} value={region}>{region}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>
            {loading ? (
              <EmptyState text="加载中..." />
            ) : visibleItems.length === 0 ? (
              <EmptyState text="暂无待办" />
            ) : (
              <div className="space-y-2 p-3">
                {visibleItems.map((item) => {
                  const nextActionLabel = item.next_action?.label || item.action_label;
                  const meta = nextActionLabel || item.reason || item.status || '-';
                  return (
                    <QueueRow
                      key={item.id}
                      title={item.title || item.student_name || `待办 #${item.source_id}`}
                      meta={meta}
                      detailParts={compactParts([
                        item.next_action?.owner_name || item.agent_name || '未知坐席',
                        item.region,
                        item.school_name,
                        formatDateTime(item.next_action?.due_at || item.due_at),
                        item.status,
                        item.reason !== meta ? item.reason : null,
                      ])}
                      tone={toneFor(item)}
                      to={item.target_url}
                      action={actionFor(item)}
                    />
                  );
                })}
              </div>
            )}
            {!loading && (total > PAGE_SIZE || page > 1) && (
              <div className="flex flex-col gap-2 border-t border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  第 {page} 页，共 {Math.max(Math.ceil(total / PAGE_SIZE), 1)} 页 · {total} 项
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="上一页"
                    onClick={() => setPage((current) => Math.max(current - 1, 1))}
                    disabled={page <= 1 || loading}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    上一页
                  </button>
                  <button
                    type="button"
                    aria-label="下一页"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={!hasMore || loading}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700"
                  >
                    下一页
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
