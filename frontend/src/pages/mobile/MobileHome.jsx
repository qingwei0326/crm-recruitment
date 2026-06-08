import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Phone,
  ChevronRight,
  Settings,
  ListTodo,
  CalendarClock,
  User as UserIcon,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import StatusBadge from '../../components/StatusBadge';
import IntentLevelBadge from '../../components/IntentLevelBadge';
import MobileDialResult from '../../components/MobileDialResult';
import useTodayTasks from '../../hooks/useTodayTasks';
import useDialFlow from '../../hooks/useDialFlow';
import { formatDateTime } from '../../utils';

function StatCard({ label, value, color = 'blue' }) {
  const colorMap = {
    blue: 'text-blue-600 dark:text-blue-300',
    green: 'text-green-600 dark:text-green-300',
    amber: 'text-amber-600 dark:text-amber-300',
    gray: 'text-gray-700 dark:text-gray-200',
  };
  return (
    <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 px-3 py-3 text-center">
      <div className={`text-xl font-bold ${colorMap[color] || colorMap.gray}`}>{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
    </div>
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

function StudentRow({ s, dialCount, dialMax = 3, onDial, onDetail, dialing }) {
  const overLimit = (dialCount ?? 0) >= dialMax;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4 space-y-3">
      <button
        type="button"
        onClick={() => onDetail(s.id)}
        className="w-full text-left flex items-start gap-3"
      >
        <div className="shrink-0 w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center font-semibold text-lg">
          {(s.name || '?').slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
              {s.name}
            </span>
            <StatusBadge status={s.status} />
            <IntentLevelBadge level={s.intent_level} />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
            {s.school_name || '-'}
            {s.region ? ` · ${s.region}` : ''}
          </div>
          {s.guardian_name && (
            <div className="text-xs text-gray-400 mt-0.5 truncate">
              {s.guardian_name} {s.guardian_phone || ''}
            </div>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 shrink-0 mt-1" />
      </button>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={dialing}
          onClick={() => onDial(s.id)}
          className={`flex-1 inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl text-base font-semibold transition active:scale-95 ${
            overLimit
              ? 'bg-red-600 text-white'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          } disabled:opacity-60`}
        >
          {dialing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Phone className="w-5 h-5" />}
          {overLimit ? `已 ${dialCount} 次 · 仍拨打` : '拨号'}
        </button>
        <button
          type="button"
          onClick={() => onDetail(s.id)}
          className="px-4 min-h-[48px] rounded-xl border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 active:scale-95"
        >
          详情
        </button>
      </div>
      {overLimit && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-300">
          <AlertTriangle className="w-3.5 h-3.5" />
          24h 内已拨打 {dialCount} 次，注意频次
        </div>
      )}
    </div>
  );
}

function TabBar({ active }) {
  const items = [
    { key: 'tasks', to: '/mobile', label: '任务', icon: ListTodo },
    { key: 'pending', to: '/mobile?tab=pending', label: '待办', icon: CalendarClock },
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
            className={`flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] text-xs ${
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
      .catch(() => {})
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
        className="w-full bg-white dark:bg-gray-900 rounded-t-2xl p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-4 max-h-[85vh] overflow-y-auto"
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

        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-3">
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

function PendingList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .get('/follow-ups/my-pending')
      .then((r) => {
        if (r.data.code === 0) setItems(r.data.data || []);
        else setError(r.data.msg || '加载失败');
      })
      .catch((e) =>
        setError(e?.response?.data?.detail || e?.response?.data?.msg || '加载失败'),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }
  if (error) {
    return <div className="text-center text-sm text-red-500 py-10">{error}</div>;
  }
  if (items.length === 0) {
    return <div className="text-center text-sm text-gray-400 py-10">暂无待办回访</div>;
  }
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => navigate(`/mobile/student/${it.student_id}`)}
          className={`w-full text-left bg-white dark:bg-gray-800 rounded-2xl border p-4 ${
            it.overdue
              ? 'border-red-200 dark:border-red-800'
              : 'dark:border-gray-700'
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {it.student_name}
            </span>
            <StatusBadge status={it.status} />
            <IntentLevelBadge level={it.intent_level} />
            {it.overdue && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-semibold">
                逾期
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {formatDateTime(it.follow_up_date)} · {it.follow_up_type || '电话'}
          </div>
          {it.notes && (
            <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 break-words">
              {it.notes}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function MePanel({ onOpenSettings }) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4">
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
        onClick={onOpenSettings}
        className="w-full bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4 text-left text-sm text-gray-800 dark:text-gray-200 min-h-[56px] flex items-center justify-between"
      >
        <span>PushPlus Token 设置</span>
        <ChevronRight className="w-4 h-4 text-gray-400" />
      </button>

      <button
        type="button"
        onClick={toggle}
        className="w-full bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4 text-left text-sm text-gray-800 dark:text-gray-200 min-h-[56px] flex items-center justify-between"
      >
        <span>主题模式</span>
        <span className="text-gray-500 dark:text-gray-400">{dark ? '深色' : '浅色'}</span>
      </button>

      <button
        type="button"
        onClick={async () => {
          await logout();
          window.location.href = '/login';
        }}
        className="w-full min-h-[48px] bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 rounded-2xl text-sm font-medium"
      >
        退出登录
      </button>
    </div>
  );
}

export default function MobileHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { students, stats, schools, loading, error, refetch } = useTodayTasks();
  const { dial, checkDup } = useDialFlow();
  const [dialCountMap, setDialCountMap] = useState({});
  const [dialingId, setDialingId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState('tasks');
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [dialMax, setDialMax] = useState(3);

  useEffect(() => {
    api.get('/students/agent/settings')
      .then(r => { if (r.data?.data?.dial_max_per_24h) setDialMax(r.data.data.dial_max_per_24h); })
      .catch(() => {});
  }, []);

  // 学校分组：后端 SQL 聚合的全量结果（不受列表上限影响）
  const schoolGroups = schools;

  // 按选中学校过滤当前已加载列表
  const filteredStudents = useMemo(() => {
    if (!selectedSchool) return students;
    return students.filter((s) => (s.school_name || '未知学校') === selectedSchool);
  }, [students, selectedSchool]);

  // 统计：未选学校时直接用后端全量 stats；选了学校则从当前列表派生
  const filteredStats = useMemo(() => {
    if (!selectedSchool) return stats;
    const list = filteredStudents;
    const total = list.length;
    const done = list.filter((s) => s.status === 'contacted').length;
    const pending = list.filter((s) => s.status === 'not_contacted').length;
    const follow_up = list.filter((s) => s.status === 'pending_visit').length;
    const handled = done + follow_up;
    return {
      total,
      done,
      pending,
      follow_up,
      progress_pct: total > 0 ? Math.round((handled / total) * 1000) / 10 : 0,
    };
  }, [selectedSchool, stats, filteredStudents]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (t === 'pending' || t === 'me') setTab(t);
    else setTab('tasks');
  }, []);

  // 预查每个学生的 24h 拨打次数（拉一次即可，新增量靠拨号后刷新）
  useEffect(() => {
    if (!students || students.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates = {};
      for (const s of students) {
        const dc = await checkDup(s.id);
        if (dc) updates[s.id] = dc.count ?? 0;
      }
      if (!cancelled) {
        setDialCountMap((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [students, checkDup]);

  const handleDial = async (id) => {
    setDialingId(id);
    try {
      const s = students.find((x) => x.id === id);
      await dial(id, { studentName: s?.name });
      const dc = await checkDup(id);
      if (dc) setDialCountMap((prev) => ({ ...prev, [id]: dc.count ?? 0 }));
    } finally {
      setDialingId(null);
    }
  };

  const handleDetail = (id) => navigate(`/mobile/student/${id}`);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-[calc(env(safe-area-inset-bottom)+72px)]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400">你好，</div>
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {user?.name || user?.username}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refetch}
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
            <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  今日进度
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {filteredStats.progress_pct ?? 0}%
                </div>
              </div>
              <ProgressBar pct={filteredStats.progress_pct} />
              <div className="flex gap-2">
                <StatCard label="总数" value={filteredStats.total ?? 0} color="gray" />
                <StatCard label="已完成" value={filteredStats.done ?? 0} color="green" />
                <StatCard label="待回访" value={filteredStats.follow_up ?? 0} color="amber" />
                <StatCard label="未联系" value={filteredStats.pending ?? 0} color="blue" />
              </div>
            </div>

            {/* 学校筛选标签 */}
            {schoolGroups.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setSelectedSchool(null)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                    !selectedSchool
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border dark:border-gray-600'
                  }`}
                >
                  全部 {students.length}
                </button>
                {schoolGroups.map((g) => (
                  <button
                    key={g.name}
                    onClick={() => setSelectedSchool(selectedSchool === g.name ? null : g.name)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${
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

            {/* Student list */}
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : error ? (
              <div className="text-center text-sm text-red-500 py-10">{error}</div>
            ) : filteredStudents.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-12">
                {selectedSchool ? '该学校暂无任务' : '今日暂无任务'}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredStudents.map((s) => (
                  <StudentRow
                    key={s.id}
                    s={s}
                    dialCount={dialCountMap[s.id]}
                    dialMax={dialMax}
                    dialing={dialingId === s.id}
                    onDial={handleDial}
                    onDetail={handleDetail}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'pending' && <PendingList />}
        {tab === 'me' && <MePanel onOpenSettings={() => setSettingsOpen(true)} />}
      </div>

      <TabBar active={tab} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 打完电话返回后弹“选择处理结果”，更新联系状况并刷新今日任务 */}
      <MobileDialResult onUpdated={() => refetch()} />
    </div>
  );
}
