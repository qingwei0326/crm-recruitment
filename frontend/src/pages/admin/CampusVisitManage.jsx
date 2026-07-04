import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, MapPin, RefreshCw } from 'lucide-react';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import useIsMobile from '../../hooks/useIsMobile';
import { formatDateTime, getApiErrorMessage } from '../../utils';

const CAMPUS_STATUSES = ['待预约', '已预约', '已到校', '未到校', '已改期', '已取消', '已报名'];
const CAMPUS_RESULTS = ['', '已到校', '未到校', '改期', '取消', '现场报名', '继续考虑'];

function dataList(res) {
  const data = res?.data?.data;
  if (Array.isArray(data)) return data;
  return data?.list || [];
}

function filterRows(rows, filters) {
  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) return false;
    if (filters.region && !String(row.region || '').includes(filters.region)) return false;
    if (filters.agent && !String(row.creator_user_name || '').includes(filters.agent)) return false;
    if (filters.date) {
      const day = String(row.appointment_at || '').slice(0, 10);
      if (day !== filters.date) return false;
    }
    return true;
  });
}

export default function CampusVisitManage() {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ status: '', region: '', agent: '', date: '' });
  const [savingKey, setSavingKey] = useState('');
  const [resultForms, setResultForms] = useState({});
  const [enrollmentForms, setEnrollmentForms] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admissions/campus-visits', { params: { page_size: 100 } });
      const list = dataList(res);
      setRows(list);
      setResultForms((prev) => {
        const next = { ...prev };
        list.forEach((item) => {
          if (!next[item.id]) {
            next[item.id] = {
              status: item.status || '已预约',
              result: item.result || '',
              onsite_enrolled: Boolean(item.onsite_enrolled),
              result_notes: item.result_notes || '',
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

  const updateEnrollmentForm = (id, patch) => {
    setEnrollmentForms((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  };

  const saveCampusVisit = async (item) => {
    const form = resultForms[item.id] || {};
    const payload = {
      status: form.status || item.status,
      result: form.result || undefined,
      onsite_enrolled: Boolean(form.onsite_enrolled),
    };
    if (form.result_notes) payload.result_notes = form.result_notes;
    setSavingKey(`campus-${item.id}`);
    try {
      await api.patch(`/admissions/campus-visits/${item.id}`, payload);
      toast?.success('已保存到校结果');
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
      campus_visit_task_id: item.id,
      source: '到校参观后',
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
          title="到校参观"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          actionsClassName="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            aria-label="刷新到校参观"
          >
            <RefreshCw className={`w-5 h-5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </PageHeader>

        <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-4">
          <section className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="lg:mr-auto">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  <MapPin className="w-4 h-4 text-green-600" />
                  到校参观队列
                </h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  管理员回填到校结果；现场报名后直接生成结算依据。
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
                  {CAMPUS_STATUSES.map((status) => (
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
              <div className="py-10 text-center text-sm text-gray-500">暂无到校参观</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1120px] w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">学生</th>
                      <th className="px-4 py-3 text-left font-medium">预约信息</th>
                      <th className="px-4 py-3 text-left font-medium">预约人</th>
                      <th className="px-4 py-3 text-left font-medium">到校结果</th>
                      <th className="px-4 py-3 text-left font-medium">报名登记</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {filteredRows.map((item) => {
                      const resultForm = resultForms[item.id] || {};
                      const enrollmentForm = enrollmentForms[item.id] || {};
                      return (
                        <tr key={item.id} className="align-top">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{item.student_name || '-'}</div>
                            <div className="mt-1 text-xs text-gray-500">{item.region || '-'} · {item.school_name || '-'}</div>
                            <div className="mt-2 inline-flex rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-700">
                              {item.status || '-'}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                            <div>{formatDateTime(item.appointment_at)}</div>
                            <div className="mt-1 text-xs text-gray-500">{item.source || '-'} · {item.visitor_count || 1} 人</div>
                            <div className="mt-1 text-xs text-gray-500">{item.needs_pickup ? '需要接送' : '无需接送'}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                            <div>{item.creator_user_name || '-'}</div>
                            <div className="mt-1 text-xs text-gray-500">{item.reception_admin_name || '未指派接待'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="grid gap-2">
                              <select
                                aria-label={`到校状态 ${item.id}`}
                                value={resultForm.status || item.status || '已预约'}
                                onChange={(event) => updateResultForm(item.id, { status: event.target.value })}
                                className="h-9 rounded-lg border border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"
                              >
                                {CAMPUS_STATUSES.map((status) => (
                                  <option key={status} value={status}>{status}</option>
                                ))}
                              </select>
                              <select
                                aria-label={`到校结果 ${item.id}`}
                                value={resultForm.result || ''}
                                onChange={(event) => updateResultForm(item.id, { result: event.target.value })}
                                className="h-9 rounded-lg border border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"
                              >
                                {CAMPUS_RESULTS.map((result) => (
                                  <option key={result || 'empty'} value={result}>{result || '未填写结果'}</option>
                                ))}
                              </select>
                              <label className="inline-flex items-center gap-2 text-xs text-gray-500">
                                <input
                                  type="checkbox"
                                  checked={Boolean(resultForm.onsite_enrolled)}
                                  onChange={(event) => updateResultForm(item.id, { onsite_enrolled: event.target.checked })}
                                />
                                现场已报名
                              </label>
                              <button
                                type="button"
                                onClick={() => saveCampusVisit(item)}
                                disabled={savingKey === `campus-${item.id}`}
                                aria-label={`保存到校结果 ${item.id}`}
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 text-white disabled:opacity-50"
                              >
                                {savingKey === `campus-${item.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                保存
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {item.enrollment_id ? (
                              <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-300">
                                已生成报名记录 #{item.enrollment_id}
                              </div>
                            ) : (
                              <div className="grid gap-2">
                                <input
                                  aria-label={`报名专业 ${item.id}`}
                                  value={enrollmentForm.enrolled_program || ''}
                                  onChange={(event) => updateEnrollmentForm(item.id, { enrolled_program: event.target.value })}
                                  className="h-9 rounded-lg border border-gray-200 px-2 dark:border-gray-700 dark:bg-gray-900"
                                  placeholder="报名专业"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  aria-label={`报名金额 ${item.id}`}
                                  value={enrollmentForm.amount || ''}
                                  onChange={(event) => updateEnrollmentForm(item.id, { amount: event.target.value })}
                                  className="h-9 rounded-lg border border-gray-200 px-2 dark:border-gray-700 dark:bg-gray-900"
                                  placeholder="金额"
                                />
                                <button
                                  type="button"
                                  onClick={() => createEnrollment(item)}
                                  disabled={savingKey === `enroll-${item.id}`}
                                  aria-label={`登记报名 ${item.id}`}
                                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                                >
                                  {savingKey === `enroll-${item.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                  登记报名
                                </button>
                              </div>
                            )}
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
