import { useEffect, useState, useMemo, useRef, useLayoutEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import logger from '../../utils/logger';
import {
  Phone,
  ChevronRight,
  Settings,
  ListTodo,
  CalendarClock,
  User as UserIcon,
  Loader2,
  RefreshCw,
  Search,
  X,
  ListChecks,
} from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import StatusBadge from '../../components/StatusBadge';
import MobileDialResult from '../../components/MobileDialResult';
import useTodayTasks from '../../hooks/useTodayTasks';
import useDialFlow from '../../hooks/useDialFlow';
import { useToast } from '../../components/Toast';
import HelpModal from '../../components/HelpModal';
import {
  PersonalGroupBadges,
  PersonalGroupBulkBar,
  PersonalGroupFilter,
  UNGROUPED_FILTER,
} from '../../components/PersonalGroups';
import YesterdayUncontactedPrompt from '../../components/YesterdayUncontactedPrompt';
import { ContentSkeleton, EmptyState, ErrorState } from '../../components/AsyncState';

function StatCard({ label, value, color = 'blue', onClick, hint }) {
  const colorMap = {
    blue: 'text-blue-600 dark:text-blue-300',
    green: 'text-green-600 dark:text-green-300',
    amber: 'text-amber-600 dark:text-amber-300',
    gray: 'text-gray-700 dark:text-gray-200',
  };
  const Component = onClick ? 'button' : 'div';
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className="min-w-0 rounded-panel border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition active:scale-[0.98] dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
        {onClick ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" /> : null}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${colorMap[color] || colorMap.gray}`}>{value}</div>
      {hint ? <div className="mt-1 truncate text-2xs text-slate-400 dark:text-slate-500">{hint}</div> : null}
    </Component>
  );
}

function ProgressBar({ pct }) {
  const safe = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
      <div
        className="h-full bg-blue-500 dark:bg-blue-400 transition-all"
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

export function StudentRow({ s, onDial, onDetail, dialing, overdueOnly = false }) {
  const contacts = [
    {
      key: 'guardian',
      label: s.guardian_name || '监护人',
      phone: s.guardian_phone,
    },
    {
      key: 'guardian2',
      label: s.guardian2_name || '监护人2',
      phone: s.guardian2_phone,
    },
  ].filter((contact) => contact.phone);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-panel border dark:border-gray-700 p-3.5 min-[380px]:p-4 space-y-3">
      <button
        type="button"
        onClick={() => onDetail(s.id)}
        className="w-full text-left grid grid-cols-[minmax(0,1fr)_20px] gap-3"
      >
        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <span className="min-w-0 truncate text-base font-semibold text-gray-900 dark:text-gray-100">
              {s.name}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            <StatusBadge status={s.status} />
            {s.status_detail && (
              <span className="text-2xs px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300">
                {s.status_detail}
              </span>
            )}
            {overdueOnly && (
              <span className="text-2xs px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300">
                逾期未处理
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
            来源片区：{s.school_name || s.region || '-'}
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 shrink-0 mt-1" />
      </button>
      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        {contacts.length > 0 ? (
          contacts.map((contact) => (
            <button
              key={contact.key}
              type="button"
              disabled={dialing}
              onClick={() => onDial(s.id, contact.key)}
              className="inline-flex h-12 min-w-0 items-center justify-center gap-2 rounded-panel bg-blue-600 px-3 text-sm font-semibold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-60"
              aria-label={`拨打 ${s.name || '学生'} ${contact.label}`}
            >
              {dialing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Phone className="w-5 h-5" />}
              <span className="truncate">拨 {contact.label}</span>
            </button>
          ))
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex h-12 items-center justify-center gap-2 rounded-panel bg-gray-100 text-sm font-semibold text-gray-400 dark:bg-gray-700 dark:text-gray-500"
          >
            <Phone className="w-5 h-5" />
            无电话
          </button>
        )}
      </div>
    </div>
  );
}

function TabBar({ active }) {
  const items = [
    { key: 'tasks', to: '/mobile', label: '待拨打', icon: ListTodo },
    { key: 'pending', to: '/mobile?tab=pending', label: '待处理', icon: CalendarClock },
    { key: 'me', to: '/mobile?tab=me', label: '我的', icon: UserIcon },
  ];
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t dark:border-gray-700 flex pb-[env(safe-area-inset-bottom)]"
    >
      {items.map((it) => {
        const Icon = it.icon;
        const isActive = active === it.key;
        return (
          <Link
            key={it.key}
            to={it.to}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 min-h-[64px] text-xs ${
              isActive
                ? 'text-blue-600 dark:text-blue-300'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <Icon className="w-5 h-5 mb-0.5" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

const PENDING_STATUS_FILTERS = [
  { label: '全部', value: null },
  { label: '已联系', value: '已联系' },
  { label: '未接', value: '未接' },
  { label: '待回访', value: '待回访' },
];

const PENDING_RESULT_FILTERS = [
  { label: '全部结果', value: null },
  { label: '等待志愿', value: '等待志愿' },
];

function SettingsSheet({ open, onClose }) {
  const { user, logout } = useAuth();
  const [token, setToken] = useState('');
  const [loadingToken, setLoadingToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    setMsg('');
    setLoadingToken(true);
    api
      .get('/auth/me')
      .then((r) => {
        if (r.data.code === 0) setToken(r.data.data?.pushplus_token || '');
      })
      .catch((e) => logger.error('加载推送设置失败:', e))
      .finally(() => setLoadingToken(false));
  }, [open]);

  if (!open) return null;

  const saveToken = async () => {
    setSavingToken(true);
    setMsg('');
    try {
      const r = await api.put('/auth/me/pushplus-token', { pushplus_token: token.trim() });
      if (r.data.code === 0) {
        setMsg('已保存');
      } else {
        setMsg(r.data.msg || '保存失败');
      }
    } catch (e) {
      setMsg(e?.response?.data?.detail || e?.response?.data?.msg || '保存失败');
    } finally {
      setSavingToken(false);
      setTimeout(() => setMsg(''), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-white dark:bg-gray-900 rounded-t-panel p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">设置</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 dark:text-gray-400 px-2 py-1"
          >
            关闭
          </button>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800 rounded-panel px-3 py-3">
          <div className="text-xs text-gray-400 mb-0.5">当前用户</div>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {user?.name || user?.username} · {user?.role}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            PushPlus 个人 Token
          </label>
          <input
            aria-label="PushPlus 个人 Token"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={loadingToken}
            className="w-full px-3 py-3 border dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100"
            placeholder="留空使用系统默认"
          />
          <button
            type="button"
            onClick={saveToken}
            disabled={savingToken || loadingToken}
            className="mt-2 w-full min-h-[44px] bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {savingToken ? '保存中…' : '保存'}
          </button>
          {msg && (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{msg}</div>
          )}
        </div>

        <button
          type="button"
          onClick={async () => {
            await logout();
            window.location.href = '/login';
          }}
          className="w-full min-h-[44px] bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 rounded-lg text-sm font-medium"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}

const PENDING_FILTERS_STORAGE_PREFIX = 'crm-mobile-pending-filters';

function pendingFiltersStorageKey() {
  try {
    const user = JSON.parse(localStorage.getItem('crm_user') || 'null');
    return `${PENDING_FILTERS_STORAGE_PREFIX}:${user?.id || 'anonymous'}`;
  } catch {
    return `${PENDING_FILTERS_STORAGE_PREFIX}:anonymous`;
  }
}

function readPendingFilters(storageKey) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    return {
      selectedStatus: saved.selectedStatus || null,
      selectedResult: saved.selectedResult || null,
      selectedGroupId: saved.selectedGroupId || null,
      selectedRegion: saved.selectedRegion || null,
      pendingSearch: typeof saved.pendingSearch === 'string' ? saved.pendingSearch : '',
    };
  } catch {
    return {
      selectedStatus: null,
      selectedResult: null,
      selectedGroupId: null,
      selectedRegion: null,
      pendingSearch: '',
    };
  }
}

function pendingFiltersFingerprint(filters) {
  return JSON.stringify({
    selectedStatus: filters.selectedStatus || null,
    selectedResult: filters.selectedResult || null,
    selectedGroupId: filters.selectedGroupId || null,
    selectedRegion: filters.selectedRegion || null,
    pendingSearch: typeof filters.pendingSearch === 'string' ? filters.pendingSearch.trim() : '',
  });
}

function pendingListViewStorageKey(storageKey) {
  return `${storageKey}:list-view`;
}

function readPendingListView(storageKey, filters) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingListViewStorageKey(storageKey)) || 'null');
    if (!saved || saved.fingerprint !== pendingFiltersFingerprint(filters)) return null;
    if (!Array.isArray(saved.items) || saved.items.length === 0) return null;
    return {
      items: saved.items,
      counts: saved.counts && typeof saved.counts === 'object' ? saved.counts : {},
      regions: Array.isArray(saved.regions) ? saved.regions : [],
      total: Number(saved.total) || 0,
      listTotal: Number(saved.listTotal) || saved.items.length,
      scrollY: Math.max(0, Number(saved.scrollY) || 0),
    };
  } catch {
    return null;
  }
}

export function PendingList() {
  const storageKey = useMemo(pendingFiltersStorageKey, []);
  const restoredFilters = useMemo(() => readPendingFilters(storageKey), [storageKey]);
  const restoredView = useMemo(
    () => readPendingListView(storageKey, restoredFilters),
    [storageKey, restoredFilters],
  );
  const [items, setItems] = useState(restoredView?.items || []);
  const [counts, setCounts] = useState(restoredView?.counts || {});
  const [regions, setRegions] = useState(restoredView?.regions || []);
  const [total, setTotal] = useState(restoredView?.total || 0);
  const [listTotal, setListTotal] = useState(restoredView?.listTotal || 0);
  const [selectedStatus, setSelectedStatus] = useState(restoredFilters.selectedStatus);
  const [selectedResult, setSelectedResult] = useState(restoredFilters.selectedResult);
  const [selectedGroupId, setSelectedGroupId] = useState(restoredFilters.selectedGroupId);
  const [selectedRegion, setSelectedRegion] = useState(restoredFilters.selectedRegion);
  const [pendingSearch, setPendingSearch] = useState(restoredFilters.pendingSearch);
  const [loading, setLoading] = useState(!restoredView);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [groupRevision, setGroupRevision] = useState(0);
  const navigate = useNavigate();
  const pendingRequestSeqRef = useRef(0);
  const itemsRef = useRef(items);
  const restoreScrollRef = useRef(restoredView?.scrollY ?? null);
  const activeFingerprintRef = useRef(pendingFiltersFingerprint(restoredFilters));

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      selectedStatus,
      selectedResult,
      selectedGroupId,
      selectedRegion,
      pendingSearch,
    }));
  }, [storageKey, selectedStatus, selectedResult, selectedGroupId, selectedRegion, pendingSearch]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedStudentIds([]);
  }, [selectedStatus, selectedResult, selectedGroupId, selectedRegion, pendingSearch]);

  useEffect(() => {
    const handleGroupChange = (event) => {
      const membershipChanged = event.detail?.studentId || event.detail?.studentIds?.length;
      const activeGroupChanged = selectedGroupId != null && event.detail?.groupId === selectedGroupId;
      if (membershipChanged || activeGroupChanged) {
        setGroupRevision((current) => current + 1);
      }
    };
    window.addEventListener('personal-groups-changed', handleGroupChange);
    return () => window.removeEventListener('personal-groups-changed', handleGroupChange);
  }, [selectedGroupId]);

  useEffect(() => {
    const fingerprint = pendingFiltersFingerprint({
      selectedStatus,
      selectedResult,
      selectedGroupId,
      selectedRegion,
      pendingSearch,
    });
    const continuingSameView = activeFingerprintRef.current === fingerprint;
    if (!continuingSameView) {
      activeFingerprintRef.current = fingerprint;
      restoreScrollRef.current = null;
      itemsRef.current = [];
      setItems([]);
      sessionStorage.removeItem(pendingListViewStorageKey(storageKey));
    }
    // Any filter refresh supersedes a pending page request. Reset the button
    // immediately; the stale request will be ignored by requestId below.
    setLoadingMore(false);
    const requestId = ++pendingRequestSeqRef.current;
    setLoading(itemsRef.current.length === 0);
    setError('');
    const params = {
      limit: continuingSameView
        ? Math.min(200, Math.max(100, itemsRef.current.length))
        : 100,
    };
    if (selectedStatus) params.status = selectedStatus;
    if (selectedResult) params.status_detail = selectedResult;
    if (selectedGroupId === UNGROUPED_FILTER) params.ungrouped = true;
    else if (selectedGroupId) params.personal_group_id = selectedGroupId;
    if (selectedRegion) params.region = selectedRegion;
    const trimmedSearch = pendingSearch.trim();
    if (trimmedSearch) params.search = trimmedSearch;
    api
      .get('/tasks/handled', { params })
      .then((r) => {
        if (requestId !== pendingRequestSeqRef.current) return;
        if (r.data.code === 0) {
          const d = r.data.data;
          setItems(d?.list ?? (Array.isArray(d) ? d : []));
          setCounts(d?.counts ?? {});
          setRegions(d?.regions ?? []);
          setTotal(d?.total ?? 0);
          setListTotal(d?.list_total ?? d?.total ?? 0);
        } else setError(r.data.msg || '加载失败');
      })
      .catch((e) => {
        if (requestId === pendingRequestSeqRef.current) {
          setError(e?.response?.data?.detail || e?.response?.data?.msg || '加载失败');
        }
      })
      .finally(() => {
        if (requestId === pendingRequestSeqRef.current) setLoading(false);
      });
  }, [storageKey, selectedStatus, selectedResult, selectedGroupId, selectedRegion, pendingSearch, groupRevision]);

  useLayoutEffect(() => {
    if (restoreScrollRef.current === null || items.length === 0) return undefined;
    const top = restoreScrollRef.current;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top, left: 0, behavior: 'auto' });
      restoreScrollRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [items.length]);

  const loadMore = async () => {
    if (loadingMore || items.length >= listTotal) return;
    const requestId = ++pendingRequestSeqRef.current;
    setLoadingMore(true);
    const params = { limit: 100, offset: items.length };
    if (selectedStatus) params.status = selectedStatus;
    if (selectedResult) params.status_detail = selectedResult;
    if (selectedGroupId === UNGROUPED_FILTER) params.ungrouped = true;
    else if (selectedGroupId) params.personal_group_id = selectedGroupId;
    if (selectedRegion) params.region = selectedRegion;
    const trimmedSearch = pendingSearch.trim();
    if (trimmedSearch) params.search = trimmedSearch;
    try {
      const response = await api.get('/tasks/handled', { params });
      if (requestId !== pendingRequestSeqRef.current) return;
      if (response.data.code === 0) {
        const data = response.data.data;
        setItems((current) => {
          const seen = new Set(current.map((student) => student.id));
          const additions = (data?.list || []).filter((student) => !seen.has(student.id));
          return [...current, ...additions];
        });
        setListTotal(data?.list_total ?? data?.total ?? listTotal);
      } else {
        setError(response.data.msg || '加载更多失败');
      }
    } catch (requestError) {
      if (requestId === pendingRequestSeqRef.current) {
        setError(requestError?.response?.data?.detail || '加载更多失败');
      }
    } finally {
      if (requestId === pendingRequestSeqRef.current) setLoadingMore(false);
    }
  };

  const visibleTotal = total || items.length;
  const selectedStudentIdSet = new Set(selectedStudentIds);
  const allVisibleSelected = items.length > 0 && items.every((student) => selectedStudentIdSet.has(student.id));

  const toggleStudent = (studentId) => {
    setSelectedStudentIds((current) => (
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    ));
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(items.map((student) => student.id));
      setSelectedStudentIds((current) => current.filter((id) => !visibleIds.has(id)));
    } else {
      setSelectedStudentIds((current) => [
        ...new Set([...current, ...items.map((student) => student.id)]),
      ]);
    }
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedStudentIds([]);
  };

  const handleBulkApplied = (group) => {
    const selectedIds = new Set(selectedStudentIds);
    const updateGroups = (student) => {
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
    };
    setItems((current) => {
      const updated = selectedGroupId === UNGROUPED_FILTER
        ? current.filter((student) => !selectedIds.has(student.id))
        : current.map(updateGroups);
      itemsRef.current = updated;
      return updated;
    });
    if (selectedGroupId === UNGROUPED_FILTER) {
      setListTotal((current) => Math.max(0, current - selectedIds.size));
      setTotal((current) => Math.max(0, current - selectedIds.size));
    }
    exitSelectionMode();
  };

  const openStudentDetail = (studentId) => {
    sessionStorage.setItem(pendingListViewStorageKey(storageKey), JSON.stringify({
      fingerprint: pendingFiltersFingerprint({
        selectedStatus,
        selectedResult,
        selectedGroupId,
        selectedRegion,
        pendingSearch,
      }),
      items,
      counts,
      regions,
      total,
      listTotal,
      scrollY: window.scrollY,
      anchorStudentId: studentId,
    }));
    navigate(`/mobile/student/${studentId}`);
  };

  const filters = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-400" />
          <input
            value={pendingSearch}
            onChange={(e) => setPendingSearch(e.target.value)}
            placeholder="搜索姓名或手机号尾号"
            className="w-full min-h-[44px] rounded-panel border border-gray-200 bg-white pl-9 pr-10 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-900/30"
          />
          {pendingSearch && (
            <button
              type="button"
              onClick={() => setPendingSearch('')}
              className="absolute right-2 top-1/2 flex min-w-9 min-h-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600"
              aria-label="清空待处理搜索"
            >
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
          aria-label={selectionMode ? '退出批量整理' : '批量整理学生分组'}
          aria-pressed={selectionMode}
          title={selectionMode ? '退出批量整理' : '批量整理'}
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-panel border ${selectionMode ? 'border-cyan-300 bg-cyan-100 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200' : 'border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
        >
          <ListChecks className="h-5 w-5" />
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {PENDING_STATUS_FILTERS.map((filter) => {
          const count = filter.value ? (counts[filter.value] || 0) : visibleTotal;
          return (
            <button
              key={filter.value || 'all'}
              type="button"
              onClick={() => setSelectedStatus(selectedStatus === filter.value ? null : filter.value)}
              className={`shrink-0 min-h-9 px-3 py-2 rounded-full text-xs font-medium transition ${
                selectedStatus === filter.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border dark:border-gray-600'
              }`}
            >
              {filter.label} {count}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {PENDING_RESULT_FILTERS.map((filter) => (
          <button
            key={filter.value || 'all-result'}
            type="button"
            onClick={() => setSelectedResult(selectedResult === filter.value ? null : filter.value)}
            className={`shrink-0 min-h-9 px-3 py-2 rounded-full text-xs font-medium transition ${
              selectedResult === filter.value
                ? 'bg-cyan-600 text-white'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border dark:border-gray-600'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <PersonalGroupFilter
        selectedGroupId={selectedGroupId}
        onSelect={setSelectedGroupId}
      />
      {regions.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() => setSelectedRegion(null)}
            className={`shrink-0 min-h-9 px-3 py-2 rounded-full text-xs font-medium transition ${
              !selectedRegion
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border dark:border-gray-600'
            }`}
          >
            全部区域
          </button>
          {regions.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => setSelectedRegion(selectedRegion === item.name ? null : item.name)}
              className={`shrink-0 min-h-9 px-3 py-2 rounded-full text-xs font-medium transition ${
                selectedRegion === item.name
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border dark:border-gray-600'
              }`}
            >
              {item.name} {item.count}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {filters}
        <ContentSkeleton rows={3} compact />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3">
        {filters}
        <ErrorState message={error} onRetry={() => setGroupRevision((current) => current + 1)} />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="space-y-3">
        {filters}
        <EmptyState
          title="暂无待处理任务"
          description="当前筛选条件下没有需要继续跟进的学生。"
          actionLabel="清除筛选"
          onAction={() => {
            setSelectedStatus(null);
            setSelectedResult(null);
            setSelectedGroupId(null);
            setSelectedRegion(null);
            setPendingSearch('');
          }}
        />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {filters}
      {selectionMode && (
        <div className="flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleAllVisible}
            aria-label="选择当前已加载学生"
            className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
          />
          <span>选择当前已加载学生</span>
          <span className="ml-auto text-gray-400">{items.length} 人</span>
        </div>
      )}
      <PersonalGroupBulkBar
        selectedStudentIds={selectedStudentIds}
        onApplied={handleBulkApplied}
        onCancel={exitSelectionMode}
        className="sticky top-[72px] z-10 -mx-4"
      />
      <div className="space-y-3">
        {items.map((it) => (
          <div
            key={it.id}
            data-student-id={it.id}
            className={`flex items-center rounded-lg border bg-white dark:border-gray-700 dark:bg-gray-800 ${selectedStudentIdSet.has(it.id) ? 'border-cyan-400 bg-cyan-50 dark:border-cyan-700 dark:bg-cyan-950/30' : 'border-gray-200'}`}
          >
            {selectionMode && (
              <input
                type="checkbox"
                checked={selectedStudentIdSet.has(it.id)}
                onChange={() => toggleStudent(it.id)}
                aria-label={`选择 ${it.name}`}
                className="ml-3 h-5 w-5 shrink-0 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
              />
            )}
            <button
              type="button"
              onClick={() => (selectionMode ? toggleStudent(it.id) : openStudentDetail(it.id))}
              className="min-w-0 flex-1 p-3.5 text-left min-[380px]:p-4"
            >
              <div className="flex min-w-0 items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900 dark:text-gray-100">
                  {it.name}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={it.status} />
              </div>
              <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                来源片区：{it.school_name || it.region || '-'}
              </div>
              <PersonalGroupBadges groups={it.personal_groups} className="mt-2" />
              {it.notes && (
                <div className="mt-1 break-words text-xs text-gray-600 dark:text-gray-300">
                  {it.notes}
                </div>
              )}
            </button>
          </div>
        ))}
        {items.length < listTotal && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={loadMore}
            className="min-h-[48px] w-full rounded-panel border border-blue-300 bg-white text-sm font-medium text-blue-600 disabled:opacity-60 dark:border-blue-700 dark:bg-gray-800 dark:text-blue-300"
          >
            {loadingMore ? '加载中…' : `加载更多（剩余${listTotal - items.length}）`}
          </button>
        )}
      </div>
    </div>
  );
}

function MePanel({ onOpenSettings }) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const toast = useToast();
  const [showPwd, setShowPwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const handleChangePwd = async () => {
    if (!oldPwd || !newPwd) { toast?.error('请填写完整'); return; }
    if (newPwd.length < 6) { toast?.error('新密码至少6位'); return; }
    if (newPwd !== newPwd2) { toast?.error('两次密码不一致'); return; }
    setPwdLoading(true);
    try {
      const res = await api.post('/auth/change-password', { old_password: oldPwd, new_password: newPwd });
      if (res.data.code === 0) {
        toast?.success('密码修改成功');
        setShowPwd(false);
        setOldPwd(''); setNewPwd(''); setNewPwd2('');
      } else {
        toast?.error(res.data.msg || '修改失败');
      }
    } catch (e) {
      toast?.error(e?.response?.data?.detail || '修改失败');
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-gray-800 rounded-panel border dark:border-gray-700 p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center text-lg font-semibold">
            {(user?.name || user?.username || '?').slice(0, 1)}
          </div>
          <div>
            <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {user?.name || user?.username}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {user?.role} · ID {user?.id}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowPwd(!showPwd)}
        className="w-full bg-white dark:bg-gray-800 rounded-panel border dark:border-gray-700 p-4 text-left text-sm text-gray-800 dark:text-gray-200 min-h-[56px] flex items-center justify-between"
      >
        <span>修改密码</span>
        <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${showPwd ? 'rotate-90' : ''}`} />
      </button>
      {showPwd && (
        <div className="bg-white dark:bg-gray-800 rounded-panel border dark:border-gray-700 p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">当前密码</label>
            <input aria-label="当前密码" type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="请输入当前密码"
              className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">新密码</label>
            <input aria-label="新密码" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="至少6位"
              className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">确认新密码</label>
            <input aria-label="确认新密码" type="password" value={newPwd2} onChange={e => setNewPwd2(e.target.value)} placeholder="再次输入新密码"
              className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
          </div>
          <button type="button" onClick={handleChangePwd} disabled={pwdLoading}
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {pwdLoading ? '提交中...' : '确认修改'}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onOpenSettings}
        className="w-full bg-white dark:bg-gray-800 rounded-panel border dark:border-gray-700 p-4 text-left text-sm text-gray-800 dark:text-gray-200 min-h-[56px] flex items-center justify-between"
      >
        <span>PushPlus Token 设置</span>
        <ChevronRight className="w-4 h-4 text-gray-400" />
      </button>

      <button
        type="button"
        onClick={toggle}
        className="w-full bg-white dark:bg-gray-800 rounded-panel border dark:border-gray-700 p-4 text-left text-sm text-gray-800 dark:text-gray-200 min-h-[56px] flex items-center justify-between"
      >
        <span>主题模式</span>
        <span className="text-gray-500 dark:text-gray-400">{dark ? '深色' : '浅色'}</span>
      </button>

      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className="w-full bg-white dark:bg-gray-800 rounded-panel border dark:border-gray-700 p-4 text-left text-sm text-gray-800 dark:text-gray-200 min-h-[56px] flex items-center justify-between"
      >
        <span>使用说明</span>
        <ChevronRight className="w-4 h-4 text-gray-400" />
      </button>

      {helpOpen && <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} role="agent" />}

      <button
        type="button"
        onClick={async () => {
          await logout();
          window.location.href = '/login';
        }}
        className="w-full min-h-[48px] bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 rounded-panel text-sm font-medium"
      >
        退出登录
      </button>
    </div>
  );
}

export default function MobileHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    students,
    stats,
    taskProgress,
    overdueOnly,
    setOverdueOnly,
    pendingCount,
    overdueCount,
    helpCount,
    todayCompletedCount,
    schools,
    loading,
    error,
    refetch,
    search,
    setSearch,
    selectedSchool,
    setSelectedSchool,
    loadMore,
    loadingMore,
    hasMore,
  } = useTodayTasks();
  const { dial } = useDialFlow();
  const [dialingId, setDialingId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState('tasks');

  // 学校分组：后端 SQL 聚合的全量结果（不受列表上限影响）
  const schoolGroups = schools;

  // 列表已由服务端按学校过滤，stats 也是服务端按学校聚合的
  const filteredStudents = students;
  const filteredStats = stats;
  const progressStats = taskProgress || filteredStats || {};
  const progressed = (Number(progressStats.done) || 0) + (Number(progressStats.follow_up) || 0);
  const allQueueCount = pendingCount == null
    ? Number(progressStats.pending ?? filteredStats.total) || 0
    : pendingCount;
  const schoolQueueCount = schoolGroups.reduce(
    (sum, group) => sum + (Number(group.count) || 0),
    0,
  );

  // 从 URL ?tab= 驱动当前标签。依赖 location.search：TabBar 用 <Link> 切换 URL 时
  // （同路由、不重新挂载）也能重新解析，否则点底部标签视图不会切换。
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const t = params.get('tab');
    if (t === 'pending' || t === 'me') setTab(t);
    else setTab('tasks');
  }, [location.search]);

  const handleDial = async (id, contactKey = 'guardian') => {
    setDialingId(id);
    try {
      const s = students.find((x) => x.id === id);
      await dial(id, { contactKey, studentName: s?.name });
    } finally {
      setDialingId(null);
    }
  };

  const handleDetail = (id) => navigate(`/mobile/student/${id}`);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-[calc(env(safe-area-inset-bottom)+80px)]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400">你好，</div>
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {user?.name || user?.username}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch(search, selectedSchool)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-700"
            aria-label="刷新"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-700"
            aria-label="设置"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="px-4 py-4 space-y-4">
        {tab === 'tasks' && (
          <>
            {/* Progress card */}
            <div className="bg-white dark:bg-gray-800 rounded-panel border dark:border-gray-700 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  今日任务进度
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {progressStats.progress_pct ?? 0}%
                </div>
              </div>
              <ProgressBar pct={progressStats.progress_pct} />
              <div className="text-2xs text-gray-400 dark:text-gray-500">
                已推进 {progressed} / {progressStats.total ?? 0} 项任务
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  label="待首呼"
                  value={progressStats.pending ?? allQueueCount}
                  color="blue"
                  hint="进入待拨打队列"
                  onClick={() => {
                    setOverdueOnly(false);
                    navigate('/mobile');
                  }}
                />
                <StatCard
                  label="待回访"
                  value={progressStats.follow_up ?? 0}
                  color="amber"
                  hint="继续推进已联系学生"
                  onClick={() => navigate('/mobile?tab=pending')}
                />
                <StatCard label="需协助" value={helpCount} color="amber" hint="已向主管发起协助" />
                <StatCard label="今日完成" value={todayCompletedCount} color="green" hint="今日已拨打学生" />
              </div>
            </div>

            {/* 任务队列与学校筛选 */}
            <div className="space-y-2">
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setOverdueOnly(false)}
                  aria-pressed={!overdueOnly}
                  className={`shrink-0 min-h-9 px-3 py-2 rounded-full text-xs font-semibold transition ${
                    !overdueOnly
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border dark:border-gray-600'
                  }`}
                >
                  待拨打 {allQueueCount}
                </button>
                <button
                  type="button"
                  onClick={() => setOverdueOnly(!overdueOnly)}
                  aria-pressed={overdueOnly}
                  className={`shrink-0 min-h-9 px-3 py-2 rounded-full text-xs font-semibold transition ${
                    overdueOnly
                      ? 'bg-red-600 text-white'
                      : 'bg-white dark:bg-gray-700 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-900/60'
                  }`}
                >
                  逾期未处理 {Number(overdueCount) || 0}
                </button>
              </div>
              {schoolGroups.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                <button
                  type="button"
                  onClick={() => setSelectedSchool(null)}
                  className={`shrink-0 min-h-9 px-3 py-2 rounded-full text-xs font-medium transition ${
                    !selectedSchool
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border dark:border-gray-600'
                  }`}
                >
                  全部 {schoolQueueCount || allQueueCount}
                </button>
                {schoolGroups.map((g) => (
                  <button
                    key={g.name}
                    type="button"
                    onClick={() => setSelectedSchool(selectedSchool === g.name ? null : g.name)}
                    className={`shrink-0 min-h-9 px-3 py-2 rounded-full text-xs font-medium transition ${
                      selectedSchool === g.name
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border dark:border-gray-600'
                    }`}
                  >
                    {g.name} {g.count}
                  </button>
                ))}
                </div>
              )}
            </div>

            {/* 搜索框 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                aria-label="搜索姓名或电话"
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索姓名或电话"
                className="w-full pl-9 pr-9 py-2.5 rounded-panel border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 flex min-w-9 min-h-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600"
                  aria-label="清空搜索"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Student list */}
            {loading ? (
              <ContentSkeleton rows={3} compact />
            ) : error ? (
              <ErrorState message={error} onRetry={() => refetch(search, selectedSchool)} />
            ) : filteredStudents.length === 0 ? (
              <EmptyState
                title={overdueOnly ? '没有逾期任务' : selectedSchool ? '该学校暂无待首呼' : '待首呼已清空'}
                description={overdueOnly ? '当前没有逾期未处理学生。' : '很好，当前筛选范围内没有需要首次拨打的学生。'}
                actionLabel={(overdueOnly || selectedSchool || search) ? '查看全部待首呼' : '刷新任务'}
                onAction={() => {
                  setOverdueOnly(false);
                  setSelectedSchool(null);
                  setSearch('');
                  refetch('', null);
                }}
              />
            ) : (
              <div className="space-y-3">
                {filteredStudents.map((s) => (
                  <StudentRow
                    key={s.id}
                    s={s}
                    dialing={dialingId === s.id}
                    onDial={handleDial}
                    onDetail={handleDetail}
                    overdueOnly={overdueOnly}
                  />
                ))}
                {hasMore && (
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="w-full py-3 text-sm text-blue-600 dark:text-blue-400 text-center active:bg-gray-100 dark:active:bg-gray-700 rounded-panel"
                  >
                    {loadingMore ? '加载中…' : '加载更多'}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'pending' && <PendingList />}
        {tab === 'me' && <MePanel onOpenSettings={() => setSettingsOpen(true)} />}
      </div>

      <TabBar active={tab} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <YesterdayUncontactedPrompt
        user={user}
        onHandleNow={() => {
          setTab('tasks');
          navigate('/mobile', { replace: true });
          refetch();
        }}
      />

      {/* 打完电话返回后弹“选择处理结果”，更新联系状况并刷新待拨打列表 */}
      <MobileDialResult onUpdated={() => refetch()} />
    </div>
  );
}
