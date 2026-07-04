/**
 * 待处理学生列表
 * 从 /tasks/handled API 加载已联系、未接、待回访状态的学生
 * 支持状态筛选、搜索、分页加载
 *
 * @param {Object} props
 * @param {function} props.onOpenDetail - 打开学生详情回调
 */
import { useState, useEffect, useCallback } from 'react';
import { Search, X, Loader2, ChevronRight } from 'lucide-react';
import api from '../../../api';
import StatusBadge from '../../../components/StatusBadge';
import IntentLevelBadge from '../../../components/IntentLevelBadge';

const STATUS_FILTERS = [
  { label: '全部', value: null },
  { label: '已联系', value: '已联系' },
  { label: '未接', value: '未接' },
  { label: '待回访', value: '待回访' },
];

const INTENT_FILTERS = [
  { label: '全部意向', value: null },
  { label: 'A', value: 'A' },
  { label: 'B', value: 'B' },
  { label: 'C', value: 'C' },
  { label: '无', value: '无' },
];

export default function HandledView({ onOpenDetail }) {
  const [students, setStudents] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [selectedIntent, setSelectedIntent] = useState(null);
  const [total, setTotal] = useState(0);
  const [listTotal, setListTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchData = useCallback(async (statusFilter = null, searchQuery = '', intentFilter = null, reset = true) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const params = { limit: 50, offset: reset ? 0 : students.length };
      if (statusFilter) params.status = statusFilter;
      if (intentFilter) params.intent_level = intentFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const res = await api.get('/tasks/handled', { params });
      if (res.data.code === 0) {
        const list = res.data.data.list || [];
        setStudents(prev => reset ? list : [...prev, ...list]);
        setCounts(res.data.data.counts || {});
        setTotal(res.data.data.total || 0);
        setListTotal(res.data.data.list_total ?? res.data.data.total ?? 0);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [students.length]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData(selectedStatus, search, selectedIntent, true);
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedStatus, selectedIntent, search]);

  const hasMore = students.length < listTotal;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Status pills */}
      <div className="flex flex-wrap gap-2 px-4 py-3 border-b dark:border-gray-700 bg-white dark:bg-gray-800">
        {STATUS_FILTERS.map((st) => {
          const count = st.value ? (counts[st.value] || 0) : total;
          return (
            <button
              key={st.value || 'all'}
              onClick={() => setSelectedStatus(selectedStatus === st.value ? null : st.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${selectedStatus === st.value ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
            >
              {st.label} {count}
            </button>
          );
        })}
      </div>

      {/* Intent pills */}
      <div className="flex flex-wrap gap-2 px-4 py-2 border-b dark:border-gray-700 bg-white dark:bg-gray-800">
        {INTENT_FILTERS.map((filter) => (
          <button
            key={filter.value || 'all-intent'}
            type="button"
            onClick={() => setSelectedIntent(selectedIntent === filter.value ? null : filter.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${selectedIntent === filter.value ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索姓名、手机号..."
            className="w-full pl-8 pr-8 py-1.5 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : students.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-10">暂无待处理</div>
        ) : (
          <div className="divide-y dark:divide-gray-700">
            {students.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpenDetail(s.id)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors flex items-center gap-3"
              >
                <div className="shrink-0 w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center font-semibold text-sm">
                  {(s.name || '?').slice(0, 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{s.name}</span>
                    <StatusBadge status={s.status} />
                    <IntentLevelBadge level={s.intent_level} />
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {s.school_name || '-'}{s.region ? ` · ${s.region}` : ''}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              </button>
            ))}
            {hasMore && (
              <button
                onClick={() => fetchData(selectedStatus, search, selectedIntent, false)}
                disabled={loadingMore}
                className="w-full py-3 text-sm text-blue-600 dark:text-blue-400"
              >
                {loadingMore ? '加载中...' : '加载更多'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
