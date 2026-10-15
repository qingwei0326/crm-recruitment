import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Users } from 'lucide-react';
import api from '../../../api';
import { getApiErrorMessage, unwrapApiResponse } from '../../../utils';
import { ContentSkeleton, EmptyState, ErrorState } from '../../../components/AsyncState';
import { leadFilterUrl } from '../adminWorkflow';

// What each agent (or region) still has to do. Answers the questions the manager kept
// asking in the work group: who is running out of leads, whether missed calls are being
// redialed, whether A/B intents are followed up, which areas still have work.

const GROUPS = [
  { key: 'agent', label: '按话务员', icon: Users },
  { key: 'region', label: '按片区', icon: MapPin },
];

function leadsLink(groupBy, row, filters) {
  if (groupBy === 'agent') return leadFilterUrl({ assigned_to: row.key, ...filters });
  if (!row.key) return '';
  return leadFilterUrl({ region: row.key, ...filters });
}

function Count({ value, warn = false, to = '' }) {
  const number = Number(value || 0);
  const tone = warn && number > 0
    ? 'font-bold text-red-600 dark:text-red-400'
    : number > 0
      ? 'font-semibold text-slate-900 dark:text-slate-100'
      : 'text-slate-400 dark:text-slate-500';
  const text = <span className={`tabular-nums ${tone}`}>{number.toLocaleString()}</span>;
  if (!to || number === 0) return text;
  return (
    <Link to={to} className="underline-offset-2 hover:underline">
      {text}
    </Link>
  );
}

function Sub({ label, value }) {
  if (!value) return null;
  return (
    <span className="ml-1 text-3xs font-semibold text-red-600 dark:text-red-400">
      {label} {Number(value).toLocaleString()}
    </span>
  );
}

function RowName({ groupBy, row }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="truncate font-semibold text-slate-900 dark:text-slate-100">{row.label}</span>
      {groupBy === 'agent' && row.is_active === false && (
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-3xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          已停用
        </span>
      )}
      {row.needs_leads && (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-3xs font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
          已打完，可派新线索
        </span>
      )}
    </span>
  );
}

function cells(groupBy, row, canLink) {
  const link = (filters) => (canLink ? leadsLink(groupBy, row, filters) : '');
  return [
    { key: 'today_dials', label: '今日拨打', node: <Count value={row.today_dials} /> },
    {
      key: 'pending_dial',
      label: '待拨打',
      node: (
        <>
          <Count value={row.pending_dial} to={link({ status: '未联系' })} />
          <Sub label="超24h" value={row.overdue} />
        </>
      ),
    },
    {
      key: 'missed_waiting',
      label: '未接今天没重打',
      node: <Count value={row.missed_waiting} warn to={link({ status: '未接' })} />,
    },
    {
      key: 'intent_ab',
      label: 'A/B 意向',
      node: (
        <>
          <Count value={row.intent_ab} />
          <Sub label="3天没联系" value={row.intent_ab_quiet} />
        </>
      ),
    },
    { key: 'open_visits', label: '待处理报备', node: <Count value={row.open_visits} /> },
    {
      key: 'enrolled',
      label: '报名 今日/累计',
      node: (
        <span className="tabular-nums">
          <Count value={row.enrolled_today} />
          <span className="text-slate-400"> / </span>
          <Count value={row.enrolled_total} to={link({ stage: '已报名' })} />
        </span>
      ),
    },
  ];
}

export default function TeamProgressPanel({ refreshKey = 0, canViewLeadsManage = false }) {
  const [groupBy, setGroupBy] = useState('agent');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/admin/team-progress', { params: { group_by: groupBy } })
      .then((response) => {
        if (cancelled) return;
        setData(unwrapApiResponse(response));
        setError('');
      })
      .catch((e) => {
        if (!cancelled) setError(getApiErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupBy, refreshKey, retryKey]);

  const rows = data?.group_by === groupBy ? data.rows : [];
  const totals = data?.group_by === groupBy ? data.totals : null;
  const nameHeader = groupBy === 'agent' ? '话务员' : '片区';
  const headers = cells(groupBy, {}, false).map((cell) => cell.label);

  return (
    <section
      data-testid="admin-team-progress"
      className="rounded-panel border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-panel-dark"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">团队进度</h2>
          <p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">
            每人还剩多少要做。红字：分配超 24 小时没打、未接今天还没重打、A/B 3 天没联系。
          </p>
        </div>
        <div
          role="group"
          aria-label="团队进度分组"
          className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
        >
          {GROUPS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={groupBy === key}
              onClick={() => setGroupBy(key)}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold ${
                groupBy === key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState bare message={error} onRetry={() => setRetryKey((value) => value + 1)} />
      ) : loading && rows.length === 0 ? (
        <div className="p-4">
          <ContentSkeleton rows={4} compact />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          bare
          title="暂时没有进度数据"
          description={groupBy === 'agent' ? '还没有启用的话务员。' : '还没有分配出去的线索。'}
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-2xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">{nameHeader}</th>
                  {headers.map((label) => (
                    <th key={label} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((row) => (
                  <tr key={`${groupBy}-${row.key}`}>
                    <th scope="row" className="px-4 py-2.5 font-normal">
                      <RowName groupBy={groupBy} row={row} />
                    </th>
                    {cells(groupBy, row, canViewLeadsManage).map((cell) => (
                      <td key={cell.key} className="whitespace-nowrap px-3 py-2.5 text-right">
                        {cell.node}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
                  <tr>
                    <th scope="row" className="px-4 py-2 text-2xs font-semibold text-slate-500">合计</th>
                    {cells(groupBy, totals, false).map((cell) => (
                      <td key={cell.key} className="whitespace-nowrap px-3 py-2 text-right">
                        {cell.node}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <ul className="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
            {rows.map((row) => (
              <li key={`${groupBy}-${row.key}`} className="px-4 py-3">
                <RowName groupBy={groupBy} row={row} />
                <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2">
                  {cells(groupBy, row, canViewLeadsManage).map((cell) => (
                    <div key={cell.key} className="min-w-0">
                      <dt className="truncate text-3xs text-slate-500 dark:text-slate-400">{cell.label}</dt>
                      <dd className="text-sm">{cell.node}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
