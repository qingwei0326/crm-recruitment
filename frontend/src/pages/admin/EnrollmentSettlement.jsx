import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Loader2, Receipt, RefreshCw, UsersRound } from 'lucide-react';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import useIsMobile from '../../hooks/useIsMobile';
import { formatDateTime, getApiErrorMessage } from '../../utils';

const SETTLEMENT_STATUSES = ['未结算', '已结算', '暂缓', '争议'];

function dataList(res) {
  const data = res?.data?.data;
  if (Array.isArray(data)) return data;
  return data?.list || [];
}

function summaryList(res) {
  const data = res?.data?.data;
  if (Array.isArray(data)) return data;
  return data?.list || [];
}

function filterRows(rows, filters) {
  return rows.filter((row) => {
    if (filters.status && row.settlement_status !== filters.status) return false;
    if (filters.region && !String(row.region || '').includes(filters.region)) return false;
    if (filters.agent && !String(row.attributed_agent_name || '').includes(filters.agent)) return false;
    if (filters.date) {
      const day = String(row.enrolled_at || '').slice(0, 10);
      if (day !== filters.date) return false;
    }
    return true;
  });
}

function SummaryCards({ rows }) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700">
        暂无结算汇总
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {rows.map((item) => (
        <div
          key={item.attributed_agent_id}
          className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                {item.attributed_agent_name || `话务员 #${item.attributed_agent_id}`}
              </div>
              <div className="mt-1 text-xs text-gray-500">总报名 {item.total || 0}</div>
            </div>
            <BarChart3 className="w-5 h-5 shrink-0 text-blue-500" />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
            <div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{item.unsettled || 0}</div>
              <div className="text-gray-500">未结</div>
            </div>
            <div>
              <div className="font-semibold text-green-600">{item.settled || 0}</div>
              <div className="text-gray-500">已结</div>
            </div>
            <div>
              <div className="font-semibold text-amber-600">{item.postponed || 0}</div>
              <div className="text-gray-500">暂缓</div>
            </div>
            <div>
              <div className="font-semibold text-red-600">{item.disputed || 0}</div>
              <div className="text-gray-500">争议</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EnrollmentSettlementContent({ embedded = false }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [summaryRows, setSummaryRows] = useState([]);
  const [agents, setAgents] = useState([]);
  const [filters, setFilters] = useState({ status: '', region: '', agent: '', date: '' });
  const [forms, setForms] = useState({});
  const [savingKey, setSavingKey] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [recordsRes, summaryRes, agentsRes] = await Promise.all([
        api.get('/admissions/enrollments', { params: { page_size: 100 } }),
        api.get('/admissions/enrollments/summary'),
        api.get('/admin/agents'),
      ]);
      const list = dataList(recordsRes);
      setRows(list);
      setSummaryRows(summaryList(summaryRes));
      setAgents(dataList(agentsRes));
      setForms((prev) => {
        const next = { ...prev };
        list.forEach((item) => {
          if (!next[item.id]) {
            next[item.id] = {
              settlement_status: item.settlement_status || '未结算',
              settlement_notes: item.settlement_notes || '',
              attributed_agent_id: item.attributed_agent_id || '',
              attribution_reason: '',
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

  const updateForm = (id, patch) => {
    setForms((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  };

  const saveSettlement = async (item) => {
    const form = forms[item.id] || {};
    const payload = {
      settlement_status: form.settlement_status || item.settlement_status,
      settlement_notes: form.settlement_notes || undefined,
    };
    if (String(form.attributed_agent_id || '') !== String(item.attributed_agent_id || '')) {
      payload.attributed_agent_id = Number(form.attributed_agent_id);
      payload.attribution_reason = form.attribution_reason || '';
    } else if (form.attribution_reason) {
      payload.attribution_reason = form.attribution_reason;
    }
    setSavingKey(`settlement-${item.id}`);
    try {
      await api.patch(`/admissions/enrollments/${item.id}`, payload);
      toast?.success('已保存结算');
      await load();
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSavingKey('');
    }
  };

  return (
    <div className={embedded ? 'space-y-4' : 'p-4 lg:p-6 max-w-7xl mx-auto space-y-4'}>
      <section className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="lg:mr-auto">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <Receipt className="w-4 h-4 text-blue-600" />
              报名结算
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              以报名记录为结算依据，归属话务员不会因后续学生改派而变化。
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
              {SETTLEMENT_STATUSES.map((status) => (
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
            报名日期
            <input
              type="date"
              value={filters.date}
              onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))}
              className="mt-1 block h-9 rounded-lg border border-gray-200 px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </section>

      <SummaryCards rows={summaryRows} />

      <section className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-500">加载中...</div>
        ) : filteredRows.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">暂无报名记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1120px] w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">学生</th>
                  <th className="px-4 py-3 text-left font-medium">报名信息</th>
                  <th className="px-4 py-3 text-left font-medium">结算归属</th>
                  <th className="px-4 py-3 text-left font-medium">结算处理</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {filteredRows.map((item) => {
                  const form = forms[item.id] || {};
                  return (
                    <tr key={item.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{item.student_name || '-'}</div>
                        <div className="mt-1 text-xs text-gray-500">{item.region || '-'} · {item.school_name || '-'}</div>
                        <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          {item.settlement_status || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        <div>{item.enrolled_program || '-'}</div>
                        <div className="mt-1 text-xs text-gray-500">{formatDateTime(item.enrolled_at)}</div>
                        <div className="mt-1 text-xs text-gray-500">金额 {item.amount ?? '-'}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        <div>{item.attributed_agent_name || '-'}</div>
                        <div className="mt-1 text-xs text-gray-500">{item.attribution_method || '-'}</div>
                        <div className="mt-1 text-xs text-gray-500">{item.source || '-'}</div>
                        {item.settlement_notes && (
                          <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                            {item.settlement_notes}
                          </div>
                        )}
                        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                          <div className="mb-2 flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100">
                            <UsersRound className="w-3.5 h-3.5" />
                            归属证据
                          </div>
                          <div>首次分配：{item.first_assigned_agent_name || '-'}</div>
                          <div>当前负责：{item.current_assigned_agent_name || '-'}</div>
                          <div>最后跟进：{item.last_effective_agent_name || '-'}</div>
                          <div>家访申请：{item.home_visit_creator_agent_name || '-'}</div>
                          <div>到校预约：{item.campus_visit_creator_user_name || '-'}</div>
                          <div className="mt-2 text-amber-700 dark:text-amber-300">
                            {item.handover_policy}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="grid gap-2 md:grid-cols-[140px_140px_1fr_1fr_auto] md:items-center">
                          <select
                            aria-label={`结算状态 ${item.id}`}
                            value={form.settlement_status || item.settlement_status || '未结算'}
                            onChange={(event) => updateForm(item.id, { settlement_status: event.target.value })}
                            className="h-9 rounded-lg border border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"
                          >
                            {SETTLEMENT_STATUSES.map((status) => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                          <select
                            aria-label={`归属话务员 ${item.id}`}
                            value={form.attributed_agent_id || item.attributed_agent_id || ''}
                            onChange={(event) => updateForm(item.id, { attributed_agent_id: event.target.value })}
                            className="h-9 rounded-lg border border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"
                          >
                            <option value="">选择话务员</option>
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>{agent.name}</option>
                            ))}
                          </select>
                          <input
                            aria-label={`归属原因 ${item.id}`}
                            value={form.attribution_reason || ''}
                            onChange={(event) => updateForm(item.id, { attribution_reason: event.target.value })}
                            className="h-9 rounded-lg border border-gray-200 px-2 dark:border-gray-700 dark:bg-gray-900"
                            placeholder="归属/争议处理原因"
                          />
                          <input
                            aria-label={`结算备注 ${item.id}`}
                            value={form.settlement_notes || ''}
                            onChange={(event) => updateForm(item.id, { settlement_notes: event.target.value })}
                            className="h-9 rounded-lg border border-gray-200 px-2 dark:border-gray-700 dark:bg-gray-900"
                            placeholder="结算备注"
                          />
                          <button
                            type="button"
                            onClick={() => saveSettlement(item)}
                            disabled={savingKey === `settlement-${item.id}`}
                            aria-label={`保存结算 ${item.id}`}
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-white disabled:opacity-50"
                          >
                            {savingKey === `settlement-${item.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                            保存
                          </button>
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
  );
}

export default function EnrollmentSettlement({ embedded = false }) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (embedded) {
    return <EnrollmentSettlementContent embedded />;
  }

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="报名结算"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <EnrollmentSettlementContent />
      </main>
    </AdminLayout>
  );
}
