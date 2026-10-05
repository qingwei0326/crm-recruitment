import { EmptyState } from '../../../components/AsyncState';
/**
 * 待处理学生列表
 * 从 /tasks/handled API 加载已联系、未接、待回访状态的学生
 * 支持状态筛选、搜索、分页加载
 *
 * @param {Object} props
 * @param {function} props.onOpenDetail - 打开学生详情回调
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, Loader2, ChevronRight, ListChecks } from 'lucide-react';
import api from '../../../api';
import StatusBadge from '../../../components/StatusBadge';
import IntentLevelBadge from '../../../components/IntentLevelBadge';
import {
  PersonalGroupBadges,
  PersonalGroupBulkBar,
  PersonalGroupFilter,
  UNGROUPED_FILTER,
} from '../../../components/PersonalGroups';

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

const RESULT_FILTERS = [
  { label: '全部结果', value: null },
  { label: '等待志愿', value: '等待志愿' },
];

function handledFiltersStorageKey() {
  try {
    const user = JSON.parse(localStorage.getItem('crm_user') || 'null');
    return `crm-agent-handled-filters:${user?.id || 'anonymous'}`;
  } catch {
    return 'crm-agent-handled-filters:anonymous';
  }
}

function readHandledFilters(storageKey) {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey) || '{}');
  } catch {
    return {};
  }
}

export default function HandledView({ onOpenDetail }) {
  const [storageKey] = useState(handledFiltersStorageKey);
  const [restoredFilters] = useState(() => readHandledFilters(storageKey));
  const [students, setStudents] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(restoredFilters.search || '');
  const [selectedStatus, setSelectedStatus] = useState(restoredFilters.selectedStatus || null);
  const [selectedIntent, setSelectedIntent] = useState(restoredFilters.selectedIntent || null);
  const [selectedResult, setSelectedResult] = useState(restoredFilters.selectedResult || null);
  const [selectedGroupId, setSelectedGroupId] = useState(restoredFilters.selectedGroupId || null);
  const [total, setTotal] = useState(0);
  const [listTotal, setListTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const studentCountRef = useRef(0);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      search,
      selectedStatus,
      selectedIntent,
      selectedResult,
      selectedGroupId,
    }));
  }, [search, selectedGroupId, selectedIntent, selectedResult, selectedStatus, storageKey]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedStudentIds([]);
  }, [search, selectedGroupId, selectedIntent, selectedResult, selectedStatus]);

  const fetchData = useCallback(async (
    statusFilter = null,
    searchQuery = '',
    intentFilter = null,
    resultFilter = null,
    groupId = null,
    reset = true,
  ) => {
    const requestId = ++requestSeqRef.current;
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const params = { limit: 50, offset: reset ? 0 : studentCountRef.current };
      if (statusFilter) params.status = statusFilter;
      if (intentFilter) params.intent_level = intentFilter;
      if (resultFilter) params.status_detail = resultFilter;
      if (groupId === UNGROUPED_FILTER) params.ungrouped = true;
      else if (groupId) params.personal_group_id = groupId;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const res = await api.get('/tasks/handled', { params });
      if (requestId !== requestSeqRef.current) return;
      if (res.data.code === 0) {
        const list = res.data.data.list || [];
        setStudents(prev => reset ? list : [...prev, ...list]);
        studentCountRef.current = reset ? list.length : studentCountRef.current + list.length;
        setCounts(res.data.data.counts || {});
        setTotal(res.data.data.total || 0);
        setListTotal(res.data.data.list_total ?? res.data.data.total ?? 0);
      }
    } catch {
      // silently fail
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData(selectedStatus, search, selectedIntent, selectedResult, selectedGroupId, true);
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedStatus, selectedIntent, selectedResult, selectedGroupId, search, fetchData]);

  useEffect(() => {
    const handleGroupChange = (event) => {
      const membershipChanged = event.detail?.studentId || event.detail?.studentIds?.length;
      const activeGroupChanged = selectedGroupId != null && event.detail?.groupId === selectedGroupId;
      if (!membershipChanged && !activeGroupChanged) return;
      fetchData(selectedStatus, search, selectedIntent, selectedResult, selectedGroupId, true);
    };
    window.addEventListener('personal-groups-changed', handleGroupChange);
    return () => window.removeEventListener('personal-groups-changed', handleGroupChange);
  }, [fetchData, search, selectedGroupId, selectedIntent, selectedResult, selectedStatus]);

  const hasMore = students.length < listTotal;
  const selectedStudentIdSet = new Set(selectedStudentIds);
  const allVisibleSelected = students.length > 0 && students.every((student) => selectedStudentIdSet.has(student.id));

  const toggleStudent = (studentId) => {
    setSelectedStudentIds((current) => (
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    ));
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(students.map((student) => student.id));
      setSelectedStudentIds((current) => current.filter((id) => !visibleIds.has(id)));
    } else {
      setSelectedStudentIds((current) => [
        ...new Set([...current, ...students.map((student) => student.id)]),
      ]);
    }
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedStudentIds([]);
  };

  const handleBulkApplied = (group) => {
    const selectedIds = new Set(selectedStudentIds);
    setStudents((current) => {
      if (selectedGroupId === UNGROUPED_FILTER) {
        const remaining = current.filter((student) => !selectedIds.has(student.id));
        studentCountRef.current = remaining.length;
        return remaining;
      }
      return current.map((student) => {
        if (!selectedIds.has(student.id)) return student;
        const currentGroups = Array.isArray(student.personal_groups) ? student.personal_groups : [];
        if (currentGroups.some((item) => item.id === group.id)) return student;
        return {
          ...student,
          personal_groups: [...currentGroups, {
            id: group.id,
            name: group.name,
            color: group.color,
          }],
        };
      });
    });
    if (selectedGroupId === UNGROUPED_FILTER) {
      setListTotal((current) => Math.max(0, current - selectedIds.size));
      setTotal((current) => Math.max(0, current - selectedIds.size));
    }
    exitSelectionMode();
  };

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

      {/* Result filters */}
      <div className="flex flex-wrap gap-2 px-4 py-2 border-b dark:border-gray-700 bg-white dark:bg-gray-800">
        {RESULT_FILTERS.map((filter) => (
          <button
            key={filter.value || 'all-result'}
            type="button"
            onClick={() => setSelectedResult(selectedResult === filter.value ? null : filter.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${selectedResult === filter.value ? 'bg-cyan-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Personal groups */}
      <div className="px-4 py-2 border-b dark:border-gray-700 bg-white dark:bg-gray-800">
        <PersonalGroupFilter selectedGroupId={selectedGroupId} onSelect={setSelectedGroupId} />
      </div>

      {/* Search and bulk mode */}
      <div className="flex items-center gap-2 border-b bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
        <div className="relative min-w-0 flex-1">
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
        <button
          type="button"
          onClick={() => {
            if (selectionMode) exitSelectionMode();
            else setSelectionMode(true);
          }}
          aria-pressed={selectionMode}
          className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium ${selectionMode ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
        >
          <ListChecks className="h-4 w-4" />
          {selectionMode ? '退出整理' : '批量整理'}
        </button>
      </div>

      {selectionMode && (
        <div className="flex min-h-[42px] items-center gap-2 border-b bg-gray-50 px-4 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleAllVisible}
            aria-label="选择当前已加载学生"
            className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
          />
          <span>选择当前已加载学生</span>
          <span className="ml-auto text-gray-400">{students.length} 人</span>
        </div>
      )}

      <PersonalGroupBulkBar
        selectedStudentIds={selectedStudentIds}
        onApplied={handleBulkApplied}
        onCancel={exitSelectionMode}
      />

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : students.length === 0 ? (
          <EmptyState bare title="暂无待处理" />
        ) : (
          <div className="divide-y dark:divide-gray-700">
            {students.map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${selectedStudentIdSet.has(s.id) ? 'bg-cyan-50 dark:bg-cyan-950/30' : ''}`}
              >
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={selectedStudentIdSet.has(s.id)}
                    onChange={() => toggleStudent(s.id)}
                    aria-label={`选择 ${s.name}`}
                    className="ml-4 h-4 w-4 shrink-0 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                  />
                )}
                <button
                  type="button"
                  onClick={() => (selectionMode ? toggleStudent(s.id) : onOpenDetail(s.id))}
                  className={`flex min-w-0 flex-1 items-center gap-3 py-3 text-left ${selectionMode ? 'pr-4' : 'px-4'}`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                    {(s.name || '?').slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{s.name}</span>
                      <StatusBadge status={s.status} />
                      <IntentLevelBadge level={s.intent_level} />
                    </div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {s.school_name || '-'}{s.region ? ` · ${s.region}` : ''}
                    </div>
                    <PersonalGroupBadges groups={s.personal_groups} className="mt-1" />
                  </div>
                  {!selectionMode && <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
                </button>
              </div>
            ))}
            {hasMore && (
              <button
                onClick={() => fetchData(selectedStatus, search, selectedIntent, selectedResult, selectedGroupId, false)}
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
