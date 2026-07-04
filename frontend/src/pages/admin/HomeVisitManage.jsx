import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Home, Loader2, RefreshCw, Search } from 'lucide-react';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import useIsMobile from '../../hooks/useIsMobile';
import { formatDateTime, getApiErrorMessage } from '../../utils';

const HOME_STATUSES = ['待确认', '已确认', '已安排', '已完成', '已取消', '暂缓'];
const HOME_RESULTS = ['', '成功', '考虑中', '等成绩', '无效', '已报名', '安排到校参观'];

function dataList(res) {
  const data = res?.data?.data;
  if (Array.isArray(data)) return data;
  return data?.list || [];
}

function emptyFilters() {
  return { status: '', region: '', agent: '', date: '' };
}

function filterRows(rows, filters) {
  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) return false;
    if (filters.region && !String(row.region || '').includes(filters.region)) return false;
    if (filters.agent && !String(row.creator_agent_name || '').includes(filters.agent)) return false;
    if (filters.date) {
      const day = String(row.scheduled_at || row.requested_visit_time || '').slice(0, 10);
      if (day !== filters.date) return false;
    }
    return true;
  });
}

export default function HomeVisitManage() {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [savingKey, setSavingKey] = useState('');
  const [resultForms, setResultForms] = useState({});
  const [campusForms, setCampusForms] = useState({});
  const [enrollmentForms, setEnrollmentForms] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admissions/home-visits', { params: { page_size: 100 } });
      const list = dataList(res);
      setRows(list);
      setResultForms((prev) => {
        const next = { ...prev };
        list.forEach((item) => {
          if (!next[item.id]) {
            next[item.id] = {
              status: item.status || '待确认',
              result: item.result || '',
              result_notes: item.result_notes || '',
            };
          }
        });
        return next;
      });
      setCampusForms((prev) => {
        const next = { ...prev };
        list.forEach((item) => {
          if (!next[item.id]) {
            next[item.id] = {
              appointment_at: '',
              visitor_count: '1',
              needs_pickup: false,
            };
          }
        });
        return next;
      });
      setEnrollmentForms((prev) => {
        const next = { ...prev };
        list.forEach((item) => {
          if (!next[item.id]) {
            next[item.id] = {
              enrolled_program: item.intent_program || '',
              amount: '',
            };
          }
        });
        return next;
      });
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredRows = useMemo(() => filterRows(rows, filters), [rows, filters]);

  const updateResultForm = (id, patch) => {
    setResultForms((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  };

  const updateCampusForm = (id, patch) => {
    setCampusForms((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  };

  const updateEnrollmentForm = (id, patch) => {
    setEnrollmentForms((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  };

  const saveHomeVisit = async (item) => {
    const form = resultForms[item.id] || {};
    const payload = {
      status: form.status || item.status,
      result: form.result || undefined,
      result_notes: form.result_notes || undefined,
    };
    setSavingKey(`home-${item.id}`);
    try {
      await api.patch(`/admissions/home-visits/${item.id}`, payload);
      toast?.success('已保存家访结果');
      await load();
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSavingKey('');
    }
  };

  const scheduleCampusVisit = async (item) => {
    const form = campusForms[item.id] || {};
    const payload = {
      student_id: item.student_id,
      home_visit_task_id: item.id,
      source: '家访后',
      appointment_at: form.appointment_at || undefined,
      visitor_count: Number(form.visitor_count || 1),
      needs_pickup: Boolean(form.needs_pickup),
    };
    setSavingKey(`campus-${item.id}`);
    try {
      await api.post('/admissions/campus-visits', payload);
      toast?.success('已安排到校参观');
      await load();
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSavingKey('');
    }
  };

  const createEnrollment = async (item) => {
    const form = enrollmentForms[item.id] || {};
    const payload = {
      student_id: item.student_id,
      home_visit_task_id: item.id,
      source: '家访后',
      enrolled_program: form.enrolled_program || item.intent_program || '',
    };
    if (form.amount !== '' && form.amount != null) {
      payload.amount = Number(form.amount);
    }
    setSavingKey(`enroll-${item.id}`);
    try {
      await api.post('/admissions/enrollments', payload);
      toast?.success('已登记报名');
      await load();
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSavingKey('');
    }
  };

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="家访任务"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          actionsClassName="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            aria-label="刷新家访任务"
          >
            <RefreshCw className={`w-5 h-5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </PageHeader>

        <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-4">
          <section className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="lg:mr-auto">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  <Home className="w-4 h-4 text-blue-600" />
                  家访处理队列
                </h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  管理员确认家访安排、回填结果，并可在家访后直接排到校参观。
                </p>
              </div>
              <label className="text-xs text-gray-500">
                状态
                <select
                  value={filters.status}
                  onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                  className="mt-1 block h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="">全部</option>
                  {HOME_STATUSES.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-500">
                区域
                <input
                  value={filters.region}
                  onChange={(event) => setFilters((prev) => ({ ...prev, region: event.target.value }))}
                  className="mt-1 block h-9 w-28 rounded-lg border border-gray-200 px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                  placeholder="区域"
                />
              </label>
              <label className="text-xs text-gray-500">
                话务员
                <input
                  value={filters.agent}
                  onChange={(event) => setFilters((prev) => ({ ...prev, agent: event.target.value }))}
                  className="mt-1 block h-9 w-28 rounded-lg border border-gray-200 px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                  placeholder="姓名"
                />
              </label>
              <label className="text-xs text-gray-500">
                日期
                <input
                  type="date"
                  value={filters.date}
                  onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))}
                  className="mt-1 block h-9 rounded-lg border border-gray-200 px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
              </label>
            </div>
          </section>

          <section className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            {loading ? (
              <div className="py-10 text-center text-sm text-gray-500">加载中...</div>
            ) : filteredRows.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-500">暂无家访任务</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1120px] w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">学生</th>
                      <th className="px-4 py-3 text-left font-medium">家访信息</th>
                      <th className="px-4 py-3 text-left font-medium">申请话务员</th>
                      <th className="px-4 py-3 text-left font-medium">结果回填</th>
                      <th className="px-4 py-3 text-left font-medium">到校安排</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {filteredRows.map((item) => {
                      const resultForm = resultForms[item.id] || {};
                      const campusForm = campusForms[item.id] || {};
                      const enrollmentForm = enrollmentForms[item.id] || {};
                      return (
                        <tr key={item.id} className="align-top">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{item.student_name || '-'}</div>
                            <div className="mt-1 text-xs text-gray-500">{item.region || '-'} · {item.school_name || '-'}</div>
                            <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                              {item.status || '-'}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                            <div>{formatDateTime(item.scheduled_at || item.requested_visit_time)}</div>
                            <div className="mt-1 max-w-52 truncate text-xs text-gray-500">{item.address || '-'}</div>
                            <div className="mt-1 text-xs text-gray-500">优先级 {item.priority || '中'}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                            <div>{item.creator_agent_name || '-'}</div>
                            <div className="mt-1 text-xs text-gray-500">{item.assigned_admin_name || '未指派管理员'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="grid gap-2">
                              <select
                                aria-label={`家访状态 ${item.id}`}
                                value={resultForm.status || item.status || '待确认'}
                                onChange={(event) => updateResultForm(item.id, { status: event.target.value })}
                                className="h-9 rounded-lg border border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"
                              >
                                {HOME_STATUSES.map((status) => (
                                  <option key={status} value={status}>{status}</option>
                                ))}
                              </select>
                              <select
                                aria-label={`家访结果 ${item.id}`}
                                value={resultForm.result || ''}
                                onChange={(event) => updateResultForm(item.id, { result: event.target.value })}
                                className="h-9 rounded-lg border border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"
                              >
                                {HOME_RESULTS.map((result) => (
                                  <option key={result || 'empty'} value={result}>{result || '未填写结果'}</option>
                                ))}
                              </select>
                              <input
                                aria-label={`家访结果备注 ${item.id}`}
                                value={resultForm.result_notes || ''}
                                onChange={(event) => updateResultForm(item.id, { result_notes: event.target.value })}
                                className="h-9 rounded-lg border border-gray-200 px-2 dark:border-gray-700 dark:bg-gray-900"
                                placeholder="结果备注"
                              />
                              <button
                                type="button"
                                onClick={() => saveHomeVisit(item)}
                                disabled={savingKey === `home-${item.id}`}
                                aria-label={`保存家访结果 ${item.id}`}
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-white disabled:opacity-50"
                              >
                                {savingKey === `home-${item.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                保存
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="grid gap-2">
                              <input
                                type="datetime-local"
                                aria-label={`到校时间 ${item.id}`}
                                value={campusForm.appointment_at || ''}
                                onChange={(event) => updateCampusForm(item.id, { appointment_at: event.target.value })}
                                className="h-9 rounded-lg border border-gray-200 px-2 dark:border-gray-700 dark:bg-gray-900"
                              />
                              <label className="inline-flex items-center gap-2 text-xs text-gray-500">
                                <input
                                  type="checkbox"
                                  checked={Boolean(campusForm.needs_pickup)}
                                  onChange={(event) => updateCampusForm(item.id, { needs_pickup: event.target.checked })}
                                />
                                需要接送
                              </label>
                              <button
                                type="button"
                                onClick={() => scheduleCampusVisit(item)}
                                disabled={savingKey === `campus-${item.id}`}
                                aria-label={`安排到校 ${item.id}`}
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                              >
                                {savingKey === `campus-${item.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
                                安排到校
                              </button>
                              <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-700">
                                {item.enrollment_id ? (
                                  <div className="rounded-lg bg-green-50 px-2 py-2 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-300">
                                    已生成报名记录 #{item.enrollment_id}
                                  </div>
                                ) : (
                                  <div className="grid gap-2">
                                    <input
                                      aria-label={`家访报名专业 ${item.id}`}
                                      value={enrollmentForm.enrolled_program || ''}
                                      onChange={(event) => updateEnrollmentForm(item.id, { enrolled_program: event.target.value })}
                                      className="h-9 rounded-lg border border-gray-200 px-2 dark:border-gray-700 dark:bg-gray-900"
                                      placeholder="报名专业"
                                    />
                                    <input
                                      type="number"
                                      min="0"
                                      aria-label={`家访报名金额 ${item.id}`}
                                      value={enrollmentForm.amount || ''}
                                      onChange={(event) => updateEnrollmentForm(item.id, { amount: event.target.value })}
                                      className="h-9 rounded-lg border border-gray-200 px-2 dark:border-gray-700 dark:bg-gray-900"
                                      placeholder="金额"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => createEnrollment(item)}
                                      disabled={savingKey === `enroll-${item.id}`}
                                      aria-label={`登记家访报名 ${item.id}`}
                                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-green-200 px-3 text-green-700 hover:bg-green-50 disabled:opacity-50 dark:border-green-900/50 dark:text-green-300 dark:hover:bg-green-900/20"
                                    >
                                      {savingKey === `enroll-${item.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                      登记报名
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
