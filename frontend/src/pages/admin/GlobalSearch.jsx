import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ClipboardList,
  Loader2,
  Menu,
  Moon,
  Search,
  Sun,
  UserRoundSearch,
} from 'lucide-react';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import { formatDateTime, getApiErrorMessage } from '../../utils';
import { stageLabel, statusBadgeClass } from '../../labels';
import { useToast } from '../../components/Toast';

function compactLogText(log) {
  return log?.content || log?.note_content || [log?.old_status, log?.new_status].filter(Boolean).join(' -> ');
}

function StudentResult({ student }) {
  const latestLogText = compactLogText(student.latest_log);
  return (
    <div className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/admin/leads/${student.id}`}
              className="text-base font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600"
            >
              {student.name}
            </Link>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(student.status)}`}>
              {student.status}
            </span>
            {student.status_detail && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {student.status_detail}
              </span>
            )}
            {student.intent_level && student.intent_level !== '无' && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                {student.intent_level}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {student.school_name || '未填学校'} · {student.region || '未填地区'} · {stageLabel(student.stage) || '-'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {student.is_invalid && (
            <Link
              to={`/admin/invalid-reclaim?q=${encodeURIComponent(student.guardian_phone || student.guardian2_phone || student.name)}`}
              className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs font-medium"
            >
              无效回收
            </Link>
          )}
          <Link
            to={`/admin/leads/${student.id}`}
            className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
          >
            查看详情
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">归属话务员</div>
          <div className="mt-1 text-gray-800 dark:text-gray-100">{student.agent_name || '-'}</div>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">监护人电话</div>
          <div className="mt-1 font-mono text-gray-800 dark:text-gray-100">
            {student.guardian_name || '监护人1'} {student.guardian_phone || '-'}
          </div>
          {(student.guardian2_name || student.guardian2_phone) && (
            <div className="mt-1 font-mono text-gray-600 dark:text-gray-300">
              {student.guardian2_name || '监护人2'} {student.guardian2_phone || '-'}
            </div>
          )}
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">最近操作</div>
          <div className="mt-1 text-gray-800 dark:text-gray-100">
            {student.latest_log?.action || '-'}
          </div>
          {student.latest_log?.created_at && (
            <div className="mt-1 text-xs text-gray-500">
              {student.latest_log.operator_name || '-'} · {formatDateTime(student.latest_log.created_at)}
            </div>
          )}
        </div>
      </div>

      {latestLogText && (
        <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
          {latestLogText}
        </div>
      )}
    </div>
  );
}

function OperationLogResult({ log }) {
  const text = compactLogText(log);
  return (
    <div className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-gray-100">{log.action}</span>
            <span className="text-xs text-gray-500">{log.operator_name || '-'}</span>
            {log.student && (
              <Link
                to={`/admin/leads/${log.student.id}`}
                className="text-xs text-blue-600 dark:text-blue-300 hover:underline"
              >
                {log.student.name}
              </Link>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">{formatDateTime(log.created_at)}</div>
        </div>
        {log.student?.status && (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(log.student.status)}`}>
            {log.student.status}
          </span>
        )}
      </div>
      {text && <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">{text}</div>}
    </div>
  );
}

export default function GlobalSearch() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') || '';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [q, setQ] = useState(initialQ);
  const [searchedQ, setSearchedQ] = useState(initialQ);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ students: [], operation_logs: [] });

  const hasResults = useMemo(
    () => data.students.length > 0 || data.operation_logs.length > 0,
    [data],
  );

  const runSearch = useCallback(
    async (value) => {
      const keyword = (value || '').trim();
      setSearchedQ(keyword);
      if (!keyword) {
        setData({ students: [], operation_logs: [] });
        setSearchParams({});
        return;
      }
      setLoading(true);
      try {
        const res = await api.get('/admin/global-search', {
          params: { q: keyword, limit: 20 },
        });
        if (res.data.code === 0) {
          setData({
            students: res.data.data?.students || [],
            operation_logs: res.data.data?.operation_logs || [],
          });
          setSearchParams({ q: keyword });
        } else {
          toast?.error(res.data.msg || '搜索失败');
        }
      } catch (e) {
        toast?.error(getApiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [setSearchParams, toast],
  );

  useEffect(() => {
    if (initialQ) runSearch(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (event) => {
    event.preventDefault();
    runSearch(q);
  };

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
      <main className="flex-1 min-w-0">
        <header
          className={`sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 flex justify-between ${
            isMobile ? 'items-end pb-2' : 'h-14 items-center'
          }`}
          style={
            isMobile
              ? {
                  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
                  minHeight: 'calc(env(safe-area-inset-top, 0px) + 64px)',
                }
              : undefined
          }
        >
          <div className="flex min-h-10 items-center gap-3">
            {isMobile && (
              <button
                className="inline-flex min-w-10 min-h-10 -ml-2 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setSidebarOpen(true)}
                aria-label="打开导航"
              >
                <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              全局搜索
            </h2>
          </div>
          <button
            onClick={toggle}
            className="inline-flex min-w-10 min-h-10 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={dark ? '亮色模式' : '暗色模式'}
          >
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
        </header>

        <div className="p-4 lg:p-6 space-y-4">
          <form
            onSubmit={submit}
            className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4"
          >
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="姓名、手机号、学校、家长、操作内容"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                搜索
              </button>
            </div>
          </form>

          {!searchedQ ? (
            <div className="py-16 text-center text-gray-400">
              <UserRoundSearch className="w-10 h-10 mx-auto mb-3" />
              输入关键词后查看学生、无效线索和操作记录
            </div>
          ) : loading ? (
            <div className="py-16 text-center text-gray-400">
              <Loader2 className="w-7 h-7 animate-spin mx-auto" />
            </div>
          ) : !hasResults ? (
            <div className="py-16 text-center text-gray-400">没有找到「{searchedQ}」</div>
          ) : (
            <div className="space-y-6">
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                  <UserRoundSearch className="w-4 h-4 text-blue-600" />
                  学生线索
                  <span className="text-xs font-normal text-gray-500">{data.students.length} 条</span>
                </div>
                {data.students.length === 0 ? (
                  <div className="text-sm text-gray-400">没有匹配学生</div>
                ) : (
                  data.students.map((student) => (
                    <StudentResult key={student.id} student={student} />
                  ))
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                  <ClipboardList className="w-4 h-4 text-indigo-600" />
                  操作记录
                  <span className="text-xs font-normal text-gray-500">{data.operation_logs.length} 条</span>
                </div>
                {data.operation_logs.length === 0 ? (
                  <div className="text-sm text-gray-400">没有匹配操作记录</div>
                ) : (
                  data.operation_logs.map((log) => (
                    <OperationLogResult key={log.id} log={log} />
                  ))
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </AdminLayout>
  );
}
