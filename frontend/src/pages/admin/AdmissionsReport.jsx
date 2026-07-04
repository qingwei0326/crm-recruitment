import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Loader2,
  MapPin,
  Phone,
  Receipt,
  RefreshCw,
  School,
  Users,
} from 'lucide-react';
import api from '../../api';
import { useToast } from '../../components/Toast';
import { getApiErrorMessage } from '../../utils';

const viewTitles = {
  overview: '招生总览',
  regions: '区域转化',
  agents: '话务员转化',
  visits: '家访到校',
  settlement: '结算归属',
};

const iconMap = {
  leads: Users,
  a_intent: BarChart3,
  home_visit_reported: MapPin,
  home_visit_completed: CheckCircle2,
  campus_visit_scheduled: School,
  campus_visit_arrived: School,
  enrolled: Receipt,
};

function num(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function rate(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function objEntries(obj) {
  return Object.entries(obj || {}).filter(([, value]) => Number(value || 0) > 0);
}

function LoadingState() {
  return (
    <div className="flex min-h-72 items-center justify-center rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
      <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
    </div>
  );
}

function EmptyState({ label = '暂无报表数据' }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      {label}
    </div>
  );
}

function StatCard({ label, value, detail, icon: Icon = BarChart3, tone = 'blue' }) {
  const toneCls = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-900/50',
    green: 'bg-green-50 text-green-700 border-green-100 dark:bg-green-900/20 dark:text-green-300 dark:border-green-900/50',
    amber: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/50',
    red: 'bg-red-50 text-red-700 border-red-100 dark:bg-red-900/20 dark:text-red-300 dark:border-red-900/50',
    gray: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  }[tone];
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneCls}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium opacity-80">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          {detail ? <div className="mt-1 text-xs opacity-80">{detail}</div> : null}
        </div>
        <Icon className="h-5 w-5 shrink-0 opacity-80" />
      </div>
    </div>
  );
}

function FunnelView({ data }) {
  const funnel = data?.funnel || [];
  if (!funnel.length) return <EmptyState />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {funnel.map((item, index) => {
          const Icon = iconMap[item.key] || BarChart3;
          const tone = item.key === 'enrolled' ? 'green' : index >= 2 ? 'amber' : 'blue';
          return (
            <StatCard
              key={item.key}
              label={item.label}
              value={num(item.value)}
              detail={`占线索 ${rate(item.rate)}`}
              icon={Icon}
              tone={tone}
            />
          );
        })}
      </div>
      <div className="rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">招生漏斗</div>
        <div className="space-y-3">
          {funnel.map((item) => (
            <div key={`bar-${item.key}`}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span>{item.label}</span>
                <span>{num(item.value)} / {rate(item.rate)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700">
                <div
                  className="h-2 rounded-full bg-blue-600 dark:bg-blue-400"
                  style={{ width: `${Math.min(Number(item.rate || 0), 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RegionsView({ data }) {
  const regions = data?.regions || [];
  if (!regions.length) return <EmptyState label="暂无区域数据" />;
  return (
    <div className="rounded-lg border bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100">
        区域招生转化
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">区域</th>
              <th className="px-3 py-3 font-medium text-right">线索</th>
              <th className="px-3 py-3 font-medium text-right">A意向</th>
              <th className="px-3 py-3 font-medium text-right">家访</th>
              <th className="px-3 py-3 font-medium text-right">到校</th>
              <th className="px-3 py-3 font-medium text-right">报名</th>
              <th className="px-3 py-3 font-medium text-right">A率</th>
              <th className="px-4 py-3 font-medium text-right">报名率</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {regions.map((item) => (
              <tr key={item.region} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{item.region}</td>
                <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{num(item.total_leads)}</td>
                <td className="px-3 py-3 text-right text-red-600 dark:text-red-400">{num(item.a_count)}</td>
                <td className="px-3 py-3 text-right text-amber-600 dark:text-amber-400">{num(item.home_visits)}</td>
                <td className="px-3 py-3 text-right text-blue-600 dark:text-blue-400">{num(item.campus_visits)}</td>
                <td className="px-3 py-3 text-right font-semibold text-green-600 dark:text-green-400">{num(item.enrollments)}</td>
                <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{rate(item.a_rate)}</td>
                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{rate(item.enrollment_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgentsView({ data }) {
  const agents = data?.agents || [];
  if (!agents.length) return <EmptyState label="暂无话务员转化数据" />;
  return (
    <div className="rounded-lg border bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100">
        话务员招生转化
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">话务员</th>
              <th className="px-3 py-3 font-medium text-right">呼出</th>
              <th className="px-3 py-3 font-medium text-right">线索</th>
              <th className="px-3 py-3 font-medium text-right">A意向</th>
              <th className="px-3 py-3 font-medium text-right">上报家访</th>
              <th className="px-3 py-3 font-medium text-right">到校预约</th>
              <th className="px-3 py-3 font-medium text-right">报名归属</th>
              <th className="px-4 py-3 font-medium text-right">待结算</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {agents.map((item) => (
              <tr key={item.agent_id} className={!item.is_active ? 'opacity-60' : ''}>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                  {item.agent_name}
                  {!item.is_active ? <span className="ml-1 text-xs text-red-500">已停用</span> : null}
                </td>
                <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{num(item.calls)}</td>
                <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{num(item.total_leads)}</td>
                <td className="px-3 py-3 text-right text-red-600 dark:text-red-400">{num(item.a_count)}</td>
                <td className="px-3 py-3 text-right text-amber-600 dark:text-amber-400">{num(item.home_visit_reports)}</td>
                <td className="px-3 py-3 text-right text-blue-600 dark:text-blue-400">{num(item.campus_visit_appointments)}</td>
                <td className="px-3 py-3 text-right font-semibold text-green-600 dark:text-green-400">{num(item.enrollments)}</td>
                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{num(item.settlement_pending)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VisitsView({ data }) {
  const home = data?.visits?.home || {};
  const campus = data?.visits?.campus || {};
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <MapPin className="h-4 w-4 text-amber-500" />
          家访执行
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="总家访" value={num(home.total)} icon={MapPin} tone="amber" />
          <StatCard label="待确认" value={num(home.pending)} icon={AlertTriangle} tone="red" />
          <StatCard label="已安排" value={num(home.scheduled)} icon={School} tone="blue" />
          <StatCard label="已完成" value={num(home.completed)} icon={CheckCircle2} tone="green" />
          <StatCard label="超期未处理" value={num(home.overdue)} icon={AlertTriangle} tone="red" />
          <StatCard label="暂缓/取消" value={num((home.postponed || 0) + (home.cancelled || 0))} icon={RefreshCw} tone="gray" />
        </div>
      </div>
      <div className="rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <School className="h-4 w-4 text-blue-500" />
          到校参观执行
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="总到校" value={num(campus.total)} icon={School} tone="blue" />
          <StatCard label="待预约" value={num(campus.pending)} icon={AlertTriangle} tone="red" />
          <StatCard label="已预约" value={num(campus.scheduled)} icon={Phone} tone="blue" />
          <StatCard label="已到校" value={num(campus.arrived)} icon={CheckCircle2} tone="green" />
          <StatCard label="未到校" value={num(campus.no_show)} icon={AlertTriangle} tone="amber" />
          <StatCard label="超期未处理" value={num(campus.overdue)} icon={AlertTriangle} tone="red" />
        </div>
      </div>
    </div>
  );
}

function SettlementView({ data }) {
  const settlement = data?.settlement || {};
  const sourceRows = objEntries(settlement.by_source);
  const methodRows = objEntries(settlement.by_method);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="报名记录" value={num(settlement.total)} icon={Receipt} tone="blue" />
        <StatCard label="未结算" value={num(settlement.unsettled)} icon={AlertTriangle} tone="amber" />
        <StatCard label="已结算" value={num(settlement.settled)} icon={CheckCircle2} tone="green" />
        <StatCard label="暂缓/争议" value={num((settlement.postponed || 0) + (settlement.disputed || 0))} icon={RefreshCw} tone="red" />
        <StatCard label="手动归属" value={num(settlement.manual_attribution)} icon={Users} tone="gray" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="报名来源" rows={sourceRows} />
        <Breakdown title="归属方式" rows={methodRows} />
      </div>
    </div>
  );
}

function Breakdown({ title, rows }) {
  return (
    <div className="rounded-lg border bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100">
        {title}
      </div>
      {rows.length ? (
        <div className="divide-y dark:divide-gray-700">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-gray-700 dark:text-gray-300">{label}</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{num(value)}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState label="暂无数据" />
      )}
    </div>
  );
}

export default function AdmissionsReport({ view = 'overview' }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const showError = toast?.error;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get('/stats/admissions-report')
      .then((res) => {
        if (alive) setData(res.data.data || {});
      })
      .catch((error) => {
        if (alive) showError?.(getApiErrorMessage(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [showError]);

  const content = useMemo(() => {
    if (loading) return <LoadingState />;
    if (view === 'regions') return <RegionsView data={data} />;
    if (view === 'agents') return <AgentsView data={data} />;
    if (view === 'visits') return <VisitsView data={data} />;
    if (view === 'settlement') return <SettlementView data={data} />;
    return <FunnelView data={data} />;
  }, [data, loading, view]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {viewTitles[view] || viewTitles.overview}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            招生转化按线索当前状态统计；结算归属按报名结算记录统计。
          </p>
        </div>
        {data?.generated_at ? (
          <div className="text-xs text-gray-400">更新时间：{String(data.generated_at).slice(0, 19)}</div>
        ) : null}
      </div>
      {content}
    </section>
  );
}
