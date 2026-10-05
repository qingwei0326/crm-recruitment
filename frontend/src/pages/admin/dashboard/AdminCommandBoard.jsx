import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Headphones,
  MapPin,
  Phone,
  PhoneCall,
  PhoneOff,
  TrendingUp,
  UserRound,
  UserPlus,
} from 'lucide-react';
import { stageLabel } from '../../../labels';
import DashboardPanelError from './DashboardPanelError';
import FunnelChart from '../FunnelChart';
import {
  DashboardCardPicker,
  hasDashboardCardData,
  useDashboardCardPreferences,
} from './DashboardCardPicker';

const surface = 'rounded-panel border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-panel-dark';

function n(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value) {
  return n(value).toLocaleString();
}

function percent(value, total) {
  return total > 0 ? `${Math.round((value / total) * 1000) / 10}%` : '—';
}

function priorityValue(items, key) {
  return n(items.find((item) => item.key === key)?.value);
}

function PriorityCards({ actionItems = [], quality, availableUnassigned, canViewLeadsManage, canViewWorkCenter, preferenceUserKey }) {
  const cards = [
    {
      key: 'follow',
      title: '逾期回访',
      value: priorityValue(actionItems, 'follow'),
      detail: '超过回访时限，可能流失',
      icon: Clock3,
      tone: 'red',
      to: canViewWorkCenter ? '/admin/work-center?queue=follow' : '',
      action: '立即处理',
    },
    {
      key: 'help',
      title: '话务员求助',
      value: priorityValue(actionItems, 'help'),
      detail: '坐席发起求助，需协助处理',
      icon: Headphones,
      tone: 'orange',
      to: canViewWorkCenter ? '/admin/work-center?queue=help' : '',
      action: '立即处理',
    },
    {
      key: 'uncontacted',
      title: '已分配未拨打',
      value: n(quality?.students?.assigned_uncontacted ?? availableUnassigned),
      detail: '分配后未及时拨打，影响转化',
      icon: Phone,
      tone: 'amber',
      to: canViewLeadsManage ? '/admin/leads?assignment=assigned&status=未联系' : '',
      action: '立即处理',
    },
    {
      key: 'missing-phone',
      title: '无电话数据',
      value: n(quality?.students?.missing_phone_tasks),
      detail: '线索缺失电话，需补充完善',
      icon: PhoneOff,
      tone: 'blue',
      to: canViewLeadsManage ? '/admin/leads?active=1&missing_phone=1' : '',
      action: '立即处理',
    },
  ];
  const cardOptions = cards.map((card) => ({ ...card, label: card.title, hasData: card.value > 0, hideWhenEmpty: true }));
  const { hiddenKeys, visibleCards, toggleCard, resetCards } = useDashboardCardPreferences({
    cards: cardOptions,
    scope: 'desktop-priority',
    userKey: preferenceUserKey,
  });
  const tone = {
    red: { card: 'border-red-100 bg-red-50/65 dark:border-red-900/70 dark:bg-red-950/35', icon: 'bg-red-100 text-red-500 dark:bg-red-900/60 dark:text-red-300', value: 'text-red-600 dark:text-red-300', badge: 'border-red-200 bg-white text-red-500 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300' },
    orange: { card: 'border-orange-100 bg-orange-50/65 dark:border-orange-900/70 dark:bg-orange-950/35', icon: 'bg-orange-100 text-orange-500 dark:bg-orange-900/60 dark:text-orange-300', value: 'text-orange-600 dark:text-orange-300', badge: 'border-orange-200 bg-white text-orange-500 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-300' },
    amber: { card: 'border-amber-100 bg-amber-50/65 dark:border-amber-900/70 dark:bg-amber-950/35', icon: 'bg-amber-100 text-amber-500 dark:bg-amber-900/60 dark:text-amber-300', value: 'text-amber-600 dark:text-amber-300', badge: 'border-amber-200 bg-white text-amber-600 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
    blue: { card: 'border-blue-100 bg-blue-50/65 dark:border-blue-900/70 dark:bg-blue-950/35', icon: 'bg-blue-100 text-blue-500 dark:bg-blue-900/60 dark:text-blue-300', value: 'text-blue-600 dark:text-blue-300', badge: 'border-blue-200 bg-white text-blue-600 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300' },
  };

  return (
    <section className={`${surface} p-4 lg:p-5`} aria-label="优先处理">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">优先处理</h2>
          <p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">需要立即关注的运营事项，点击卡片进入处理队列</p>
        </div>
        <div className="flex items-center gap-2">
          <DashboardCardPicker cards={cardOptions} hiddenKeys={hiddenKeys} onToggle={toggleCard} onReset={resetCards} />
          <AlertTriangle className="h-5 w-5 text-orange-400" />
        </div>
      </div>
      {visibleCards.filter(hasDashboardCardData).length === 0 ? (
        <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/60 px-4 py-6 text-center text-xs text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-300">
          暂无需要立即处理的事项
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleCards.filter(hasDashboardCardData).map((card) => {
          const Icon = card.icon;
          const colors = tone[card.tone];
          const body = (
            <div className={`h-full rounded-xl border p-3.5 transition hover:-translate-y-0.5 hover:shadow-md ${colors.card}`}>
              <div className="flex items-start justify-between gap-2">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${colors.icon}`}><Icon className="h-5 w-5" /></div>
                <span className={`rounded border px-2 py-0.5 text-3xs font-semibold ${colors.badge}`}>{card.value > 0 ? '需处理' : '正常'}</span>
              </div>
              <div className="mt-3 flex items-end gap-2"><span className={`text-2xl font-black tabular-nums ${colors.value}`}>{formatCount(card.value)}</span><span className="pb-0.5 text-sm font-semibold text-slate-700 dark:text-slate-200">{card.title}</span></div>
              <p className="mt-1 text-2xs leading-4 text-slate-500 dark:text-slate-400">{card.detail}</p>
              <div className="mt-3 flex items-center justify-between border-t border-current/10 pt-2 text-xs font-semibold text-slate-700 dark:text-slate-200"><span>{card.action}</span><ChevronRight className="h-4 w-4" /></div>
            </div>
          );
          return card.to ? <Link key={card.key} to={card.to} className="block h-full">{body}</Link> : <div key={card.key} className="h-full">{body}</div>;
          })}
        </div>
      )}
    </section>
  );
}

function KpiStrip({ cards, loading, onRetry, preferenceUserKey, preferenceScope }) {
  const cardOptions = cards.map((card) => ({ ...card, hasData: card.value > 0, hideWhenEmpty: card.defaultVisible === false }));
  const { hiddenKeys, visibleCards, toggleCard, resetCards } = useDashboardCardPreferences({
    cards: cardOptions,
    scope: `desktop-metrics-${preferenceScope || 'today'}`,
    userKey: preferenceUserKey,
  });
  const cardsWithData = visibleCards.filter((card) => hasDashboardCardData({ ...card, loading }));
  return (
    <section aria-label="今日运营指标">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200">核心指标</div>
        <DashboardCardPicker cards={cardOptions} hiddenKeys={hiddenKeys} onToggle={toggleCard} onReset={resetCards} />
      </div>
      {cardsWithData.length === 0 ? (
        <div className={`${surface} px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-500`}>暂无可展示指标</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {cardsWithData.map((card) => {
        const Icon = card.icon;
        const body = (
          <div className={`${surface} flex min-h-[112px] flex-col justify-between p-3.5 transition hover:border-blue-200 hover:shadow-md dark:hover:border-blue-800`}>
            <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">{card.label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-full ${card.iconTone || 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300'}`}><Icon className="h-4 w-4" /></span></div>
            <div className="mt-2 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{loading ? '—' : card.error ? '--' : formatCount(card.value)}</div>
            <div className="flex items-center justify-between gap-2 text-3xs"><span className="truncate text-slate-400 dark:text-slate-500">{card.detail}</span>{card.delta && <span className={card.deltaTone === 'down' ? 'shrink-0 text-emerald-600 dark:text-emerald-400' : 'shrink-0 text-red-500 dark:text-red-400'}>{card.delta}</span>}</div>
          </div>
        );
        if (card.error) return <button key={card.label} type="button" onClick={onRetry} disabled={loading} aria-label={`重试${card.label}`} className="text-left disabled:opacity-60">{body}</button>;
        return card.to ? <Link key={card.label} to={card.to}>{body}</Link> : <div key={card.label}>{body}</div>;
          })}
        </div>
      )}
    </section>
  );
}

function FlowNode({ icon: Icon, label, value, base, tone = 'blue' }) {
  const tones = {
    blue: 'border-blue-100 bg-blue-50/45 text-blue-600 dark:border-blue-900/70 dark:bg-blue-950/35 dark:text-blue-300',
    cyan: 'border-cyan-100 bg-cyan-50/45 text-cyan-600 dark:border-cyan-900/70 dark:bg-cyan-950/35 dark:text-cyan-300',
    green: 'border-emerald-100 bg-emerald-50/45 text-emerald-600 dark:border-emerald-900/70 dark:bg-emerald-950/35 dark:text-emerald-300',
  };
  return <div className={`min-w-0 flex-1 rounded-lg border px-3 py-3 text-center ${tones[tone]}`}><Icon className="mx-auto h-5 w-5" /><div className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</div><div className="mt-1 text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">{formatCount(value)}</div><div className="mt-1 text-3xs text-slate-500 dark:text-slate-400">完成率 <span className="font-bold text-emerald-600 dark:text-emerald-400">{percent(value, base)}</span></div></div>;
}

function OperationsFlow({ total, todayNewLeads, availableUnassigned, validCalls, aLevelTotal, enrolledTotal, loading }) {
  const base = n(todayNewLeads) || n(total);
  const assigned = Math.max(base - n(availableUnassigned), 0);
  const nodes = [
    { label: '线索获取', value: todayNewLeads || total, icon: UserPlus, tone: 'blue' },
    { label: '线索分配', value: assigned, icon: UsersIcon, tone: 'blue' },
    { label: '电话触达', value: validCalls, icon: PhoneCall, tone: 'cyan' },
    { label: '意向跟进', value: aLevelTotal, icon: TrendingUp, tone: 'green' },
    { label: '报名转化', value: enrolledTotal, icon: CheckCircle2, tone: 'green' },
  ];
  return (
    <section className={`${surface} p-4 lg:p-5`}>
      <div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-bold text-slate-900 dark:text-slate-100">运营闭环</h2><p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">从线索获取到报名转化的当前承接进度</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-3xs font-semibold text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">实时同步</span></div>
      {loading ? <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">正在同步闭环数据…</div> : <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">{nodes.map((node, index) => <div key={node.label} className="flex min-w-0 flex-1 items-center gap-2"><FlowNode {...node} base={base} />{index < nodes.length - 1 && <ArrowRight className="hidden h-5 w-5 shrink-0 text-blue-400 dark:text-blue-500 md:block" />}</div>)}</div>}
    </section>
  );
}

function UsersIcon(props) {
  return <UserRound {...props} />;
}

function AgentStatusTable({ scoreItems = [], error, onRetry, retrying }) {
  const rows = [...scoreItems].sort((a, b) => n(b.metrics?.today_calls) - n(a.metrics?.today_calls)).slice(0, 5);
  return (
    <section className={`${surface} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700"><div><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">坐席工作状态</h2><p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">今日呼出、任务处理和完成进度</p></div><Link to="/admin/score-preview" className="text-2xs font-semibold text-blue-600 hover:underline dark:text-blue-400">查看详情</Link></div>
      {error ? <div className="p-4"><DashboardPanelError title="坐席状态" onRetry={onRetry} retrying={retrying} /></div> : rows.length === 0 ? <div className="px-4 py-12 text-center text-xs text-slate-400 dark:text-slate-500">暂无坐席数据</div> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-slate-50 text-3xs text-slate-500 dark:bg-slate-800 dark:text-slate-400"><tr><th className="px-4 py-2.5 font-medium">坐席</th><th className="px-2 py-2.5 font-medium">今日呼出</th><th className="px-2 py-2.5 font-medium">已完成任务</th><th className="px-2 py-2.5 font-medium">待处理任务</th><th className="px-2 py-2.5 font-medium">工作状态</th><th className="px-4 py-2.5 text-right font-medium">完成进度</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {rows.map((item) => {
            const metrics = item.metrics || {};
            const calls = n(metrics.today_calls);
            const target = Math.max(n(metrics.daily_call_target) || 30, 1);
            const completed = n(metrics.today_recorded_calls ?? metrics.completed_dial_sessions);
            const pending = n(metrics.today_pending_dial_sessions ?? metrics.pending_dial_sessions);
            const progress = Math.min(Math.round((calls / target) * 100), 100);
            const attention = ['risk', 'watch'].includes(item.level);
            return <tr key={item.agent?.id || item.agent?.username || item.agent_name} className="hover:bg-blue-50/30 dark:hover:bg-slate-800/60"><td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">{item.agent?.name || item.agent_name || '未命名坐席'}</td><td className="px-2 py-3 tabular-nums text-slate-700 dark:text-slate-300">{calls}</td><td className="px-2 py-3 tabular-nums text-slate-700 dark:text-slate-300">{completed}</td><td className="px-2 py-3 tabular-nums text-slate-700 dark:text-slate-300">{pending}</td><td className="px-2 py-3"><span className={`inline-flex items-center gap-1.5 ${attention ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}><span className={`h-1.5 w-1.5 rounded-full ${attention ? 'bg-amber-500' : 'bg-emerald-500'}`} />{item.level_label || (attention ? '需关注' : calls >= target ? '忙碌' : '空闲')}</span></td><td className="px-4 py-3"><div className="flex items-center justify-end gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className={`h-full rounded-full ${attention ? 'bg-amber-500' : 'bg-blue-600'}`} style={{ width: `${progress}%` }} /></div><span className="w-8 text-right text-3xs tabular-nums text-slate-500 dark:text-slate-400">{progress}%</span></div></td></tr>;
          })}
        </tbody></table></div>
      )}
    </section>
  );
}

function CapacityPanel({ availableUnassigned, validCalls, openFollowUps, totalStudents, quality, loading, canViewLeadsManage }) {
  const uncontacted = n(quality?.students?.assigned_uncontacted);
  const capacityTotal = Math.max(n(totalStudents), n(availableUnassigned) + uncontacted, 1);
  const assigned = Math.max(capacityTotal - n(availableUnassigned), 0);
  const assignedRate = Math.min((assigned / capacityTotal) * 100, 100);
  return (
    <section className={`${surface} p-4 lg:p-5`}>
      <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">分配池与容量</h2><p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">掌握线索承接和处理负载</p></div>{canViewLeadsManage && <Link to="/admin/leads?assignment=unassigned&active=1" className="text-2xs font-semibold text-blue-600 hover:underline dark:text-blue-400">去分配</Link>}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-lg bg-red-50 px-2 py-3 text-center dark:bg-red-950/35"><div className="text-lg font-black tabular-nums text-red-600 dark:text-red-300">{loading ? '—' : formatCount(availableUnassigned)}</div><div className="text-3xs text-slate-500 dark:text-slate-400">待分配线索</div></div><div className="rounded-lg bg-emerald-50 px-2 py-3 text-center dark:bg-emerald-950/35"><div className="text-lg font-black tabular-nums text-emerald-600 dark:text-emerald-300">{loading ? '—' : formatCount(validCalls)}</div><div className="text-3xs text-slate-500 dark:text-slate-400">今日可释放</div></div><div className="rounded-lg bg-orange-50 px-2 py-3 text-center dark:bg-orange-950/35"><div className="text-lg font-black tabular-nums text-orange-600 dark:text-orange-300">{loading ? '—' : formatCount(openFollowUps)}</div><div className="text-3xs text-slate-500 dark:text-slate-400">积压任务</div></div><div className="rounded-lg bg-blue-50 px-2 py-3 text-center dark:bg-blue-950/35"><div className="text-lg font-black tabular-nums text-blue-600 dark:text-blue-300">{loading ? '—' : '—'}</div><div className="text-3xs text-slate-500 dark:text-slate-400">预计下一波</div></div></div>
      <div className="mt-5 flex items-center justify-between text-2xs font-semibold text-slate-700 dark:text-slate-200"><span>线索分配池分布</span><span className="text-blue-600 dark:text-blue-400">已承接 {loading ? '—' : `${Math.round(assignedRate)}%`}</span></div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="bg-blue-600" style={{ width: `${assignedRate}%` }} /><div className="bg-emerald-500" style={{ width: `${Math.min((uncontacted / capacityTotal) * 100, 100 - assignedRate)}%` }} /><div className="bg-orange-400" style={{ width: `${Math.max(0, 100 - assignedRate - Math.min((uncontacted / capacityTotal) * 100, 100 - assignedRate))}%` }} /></div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-3xs text-slate-500 dark:text-slate-400"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-600" />已分配 {formatCount(assigned)}</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />已联系 {formatCount(Math.max(assigned - uncontacted, 0))}</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-orange-400" />未联系 {formatCount(uncontacted)}</span></div>
    </section>
  );
}

function StageDistribution({ stageStats = {}, error, onRetry, retrying, canViewLeadsManage }) {
  const entries = Object.entries(stageStats).filter(([stage]) => stage !== '未分配' || n(stageStats[stage]) > 0).sort((a, b) => n(b[1]) - n(a[1]));
  const total = entries.reduce((sum, [, value]) => sum + n(value), 0);
  const colors = ['#2563eb', '#14b8a6', '#f59e0b', '#8b5cf6', '#94a3b8', '#ef4444'];
  let offset = 0;
  const segments = entries.map(([, value], index) => {
    const start = offset;
    offset += total ? (n(value) / total) * 360 : 0;
    return `${colors[index % colors.length]} ${start}deg ${offset}deg`;
  });
  return <section className={`${surface} p-4 lg:p-5`}><span className="sr-only">各阶段线索实时沉淀与工作进展</span><div className="mb-3 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-blue-600 dark:text-blue-400" /><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">阶段分布</h2></div>{error ? <DashboardPanelError title="阶段分布" onRetry={onRetry} retrying={retrying} /> : entries.length === 0 ? <div className="flex h-36 items-center justify-center text-xs text-slate-400 dark:text-slate-500">暂无阶段数据</div> : <div className="flex items-center gap-4"><div className="relative h-32 w-32 shrink-0 rounded-full" style={{ background: `conic-gradient(${segments.join(', ')})` }}><div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white dark:bg-slate-900"><span className="text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">{formatCount(total)}</span><span className="text-3xs text-slate-400 dark:text-slate-500">总量</span></div></div><div className="min-w-0 flex-1 space-y-2">{entries.slice(0, 5).map(([stage, value], index) => { const label = stageLabel(stage) || stage; const row = <div key={stage} className="flex items-center justify-between gap-2 text-2xs"><span className="flex min-w-0 items-center gap-1.5 truncate text-slate-600 dark:text-slate-300"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />{label}</span><span className="shrink-0 font-bold tabular-nums text-slate-800 dark:text-slate-200">{formatCount(value)} <span className="font-normal text-slate-400 dark:text-slate-500">({percent(n(value), total)})</span></span></div>; return canViewLeadsManage ? <Link key={stage} aria-label={`${formatCount(value)} ${label}`} to={`/admin/leads?stage=${encodeURIComponent(stage)}`}>{row}</Link> : row; })}</div></div>}</section>;
}

function FunnelPanel({ funnelData, error, onRetry, retrying }) {
  return <section className={`${surface} p-4 lg:p-5`}><div className="mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">转化漏斗</h2></div>{error ? <DashboardPanelError title="转化漏斗" onRetry={onRetry} retrying={retrying} /> : funnelData ? <FunnelChart data={funnelData} /> : <div className="flex h-36 items-center justify-center text-xs text-slate-400 dark:text-slate-500">暂无漏斗数据</div>}</section>;
}

function RegionRanking({ stats = [], error, onRetry, retrying }) {
  const regions = [...stats].sort((a, b) => n(b.total) - n(a.total)).slice(0, 5);
  const max = Math.max(...regions.map((item) => n(item.total)), 1);
  return <section className={`${surface} p-4 lg:p-5`}><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">区域排行</h2></div><span className="text-3xs text-slate-400 dark:text-slate-500">按报名数</span></div>{error ? <DashboardPanelError title="区域排行" onRetry={onRetry} retrying={retrying} /> : regions.length === 0 ? <div className="flex h-36 items-center justify-center text-xs text-slate-400 dark:text-slate-500">暂无区域数据</div> : <div className="space-y-3">{regions.map((region) => <div key={region.source}><div className="flex items-center justify-between text-2xs"><span className="truncate text-slate-600 dark:text-slate-300">{region.source}</span><span className="font-bold tabular-nums text-slate-800 dark:text-slate-200">{formatCount(region.a_count)}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min((n(region.total) / max) * 100, 100)}%` }} /></div><div className="mt-1 text-[9px] text-slate-400 dark:text-slate-500">{n(region.a_count)} 名 A 级 · {n(region.total)} 名学生</div></div>)}</div>}</section>;
}

function TrendPanel({ trendData, error, onRetry, retrying }) {
  const daily = Array.isArray(trendData?.daily) ? trendData.daily.slice(-7) : [];
  const values = daily.map((item) => n(item.calls));
  const max = Math.max(...values, 1);
  const points = daily.map((item, index) => `${daily.length > 1 ? (index / (daily.length - 1)) * 100 : 50},${96 - (n(item.calls) / max) * 76}`).join(' ');
  return <section className={`${surface} p-4 lg:p-5`}><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" /><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">待回访趋势</h2></div><span className="rounded border border-slate-200 px-2 py-1 text-3xs text-slate-500 dark:border-slate-700 dark:text-slate-400">近7天</span></div>{error ? <DashboardPanelError title="趋势" onRetry={onRetry} retrying={retrying} /> : daily.length === 0 ? <div className="flex h-36 items-center justify-center text-xs text-slate-400 dark:text-slate-500">暂无趋势数据</div> : <><div className="h-32"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><path d="M0 96H100 M0 58H100 M0 20H100" stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth="0.7" fill="none" /><polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" />{daily.map((item, index) => { const x = daily.length > 1 ? (index / (daily.length - 1)) * 100 : 50; const y = 96 - (n(item.calls) / max) * 76; return <circle key={item.date} cx={x} cy={y} r="1.5" fill="#2563eb" vectorEffect="non-scaling-stroke" />; })}</svg></div><div className="mt-2 flex justify-between text-[9px] text-slate-400 dark:text-slate-500">{daily.map((item) => <span key={item.date}>{item.date?.slice(5)}</span>)}</div><div className="mt-2 text-center text-3xs text-slate-500 dark:text-slate-400">最近一天 <strong className="text-slate-800 dark:text-slate-200">{formatCount(values[values.length - 1])}</strong> 次呼出</div></>}</section>;
}

function RecentExceptions({ actionItems = [], canViewWorkCenter }) {
  const items = [
    ...actionItems.slice(0, 3).map((item) => ({ title: item.title, detail: item.detail, tone: item.tone, to: item.to })),
  ].slice(0, 5);
  return <section className={`${surface} overflow-hidden`}><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700"><div><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">最近异常</h2><p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">需要持续关注的运营事件</p></div>{canViewWorkCenter && <Link to="/admin/work-center" className="text-2xs font-semibold text-blue-600 hover:underline dark:text-blue-400">查看全部 <ArrowRight className="inline h-3 w-3" /></Link>}</div>{items.length === 0 ? <div className="px-4 py-7 text-center text-xs text-slate-400 dark:text-slate-500">暂无异常，今天运行平稳</div> : <div className="divide-y divide-slate-100 dark:divide-slate-700">{items.map((item, index) => { const row = <div className="flex items-center gap-3 px-4 py-2.5"><span className={`h-2 w-2 shrink-0 rounded-full ${item.tone === 'red' ? 'bg-red-500' : item.tone === 'amber' ? 'bg-amber-500' : 'bg-blue-500'}`} /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{item.title}</div><div className="truncate text-3xs text-slate-400 dark:text-slate-500">{item.detail}</div></div><span className="shrink-0 text-3xs text-blue-600 dark:text-blue-400">查看详情</span></div>; return item.to ? <Link key={`${item.title}-${index}`} to={item.to}>{row}</Link> : <div key={`${item.title}-${index}`}>{row}</div>; })}</div>}</section>;
}

function DailyOpsReview({ dailyOps, loading, error, savingKey, canReview, onMark, onRetry, actionItems = [], riskError }) {
  const summary = dailyOps?.summary || {};
  const activeItems = (dailyOps?.items || []).filter((item) => n(item.count) > 0 && !item.is_closed);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section className={`${surface} p-4`}>
        <div className="flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">今日运营闭环</h2><p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">记录复核进度，不改变业务状态</p></div><span className="text-3xs text-slate-400 dark:text-slate-500">{loading ? '同步中' : `${n(summary.closed_items)} / ${n(summary.total_items)} 已完成`}</span></div>
        {error ? <div className="mt-3"><DashboardPanelError title="运营闭环数据" onRetry={onRetry} retrying={loading} /></div> : activeItems.length === 0 ? <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-3 text-xs text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300">今日运营闭环暂无待处理事项</div> : <div className="mt-3 space-y-2">{activeItems.map((item) => <div key={item.key} className="rounded-lg border border-amber-100 bg-amber-50/60 p-3 dark:border-amber-900/70 dark:bg-amber-950/30"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold text-slate-800 dark:text-slate-200">{item.title}</div><div className="mt-1 text-3xs text-slate-500 dark:text-slate-400">{item.detail}</div></div><strong className="text-sm tabular-nums text-amber-600 dark:text-amber-300">{item.count}</strong></div>{item.owners?.length > 0 && <div className="mt-2 grid gap-1 sm:grid-cols-2">{item.owners.slice(0, 3).map((owner) => <Link key={`${item.key}-${owner.agent_id || owner.agent_name}`} to={owner.to || item.to || '/admin/work-center'} className="flex items-center justify-between rounded bg-white/75 px-2 py-1 text-3xs hover:bg-white dark:bg-slate-900/70 dark:hover:bg-slate-800"><span className="truncate font-medium text-slate-700 dark:text-slate-200">{owner.agent_name || '未命名坐席'}</span><span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">{n(owner.count)}项 · {n(owner.max_age_days)}天</span></Link>)}</div>}<div className="mt-2 flex flex-wrap items-center gap-2"><Link to={item.to || '/admin/work-center'} className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-3xs font-medium text-blue-600 dark:bg-slate-900 dark:text-blue-400">查看 <ArrowRight className="h-3 w-3" /></Link>{canReview && ['已处理', '暂缓', '明日继续跟进', '无需处理'].map((status) => <button key={status} type="button" disabled={savingKey === `${item.key}:${status}`} onClick={() => onMark(item, status)} className={`rounded px-2 py-1 text-3xs font-medium ${status === '已处理' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300'} disabled:opacity-50`}>{savingKey === `${item.key}:${status}` ? '记录中...' : status === '已处理' ? '确认处理' : status === '明日继续跟进' ? '明日继续' : status}</button>)}</div></div>)}</div>}
      </section>
      <section className={`${surface} p-4`}>
        <div className="flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">风险队列</h2><p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">优先处理会影响转化的异常</p></div><AlertTriangle className="h-4 w-4 text-orange-400" /></div>
        {riskError ? <div className="mt-3"><DashboardPanelError title="待办风险数据" onRetry={onRetry} retrying={loading} /></div> : actionItems.length === 0 && activeItems.length === 0 ? <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-3 text-xs text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300">今日暂无待处理风险项</div> : <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">风险项已汇总在上方优先处理区域。</div>}
      </section>
    </div>
  );
}

export default function AdminCommandBoard({
  actionItems,
  dailyOps,
  quality,
  scoreItems,
  stageStats,
  funnelData,
  stats,
  trendData,
  loading,
  errors = {},
  onRetry,
  retrying,
  canViewLeadsManage,
  canViewWorkCenter,
  canViewReportCenter,
  metricCards,
  availableUnassigned,
  totalStudents,
  aLevelTotal,
  enrolledTotal,
  todayNewLeads,
  dailyOpsLoading,
  dailyOpsError,
  dailyOpsSavingKey,
  canReviewDailyOps,
  onMarkDailyOps,
  actionItemsError = false,
  cardPreferenceUserKey,
  cardPreferenceScope = 'today',
}) {
  const validCalls = n(quality?.calls?.today?.recorded_calls);
  const openFollowUps = n(quality?.follow_ups?.open_follow_ups);
  return (
    <div className="space-y-4 lg:space-y-5">
      <PriorityCards actionItems={actionItems} quality={quality} availableUnassigned={availableUnassigned} canViewLeadsManage={canViewLeadsManage} canViewWorkCenter={canViewWorkCenter} preferenceUserKey={cardPreferenceUserKey} />
      <KpiStrip cards={metricCards} loading={loading} onRetry={onRetry} preferenceUserKey={cardPreferenceUserKey} preferenceScope={cardPreferenceScope} />
      <OperationsFlow total={totalStudents} todayNewLeads={todayNewLeads} availableUnassigned={availableUnassigned} validCalls={validCalls} aLevelTotal={aLevelTotal} enrolledTotal={enrolledTotal} loading={loading} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-5">
        <AgentStatusTable scoreItems={scoreItems} error={errors.scoreItems} onRetry={onRetry} retrying={retrying} />
        <CapacityPanel availableUnassigned={availableUnassigned} validCalls={validCalls} openFollowUps={openFollowUps} totalStudents={totalStudents} quality={quality} loading={loading} canViewLeadsManage={canViewLeadsManage} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <StageDistribution stageStats={stageStats} error={errors.stages} onRetry={onRetry} retrying={retrying} canViewLeadsManage={canViewLeadsManage} />
        <FunnelPanel funnelData={funnelData} error={errors.funnel} onRetry={onRetry} retrying={retrying} />
        <RegionRanking stats={stats} error={errors.regions} onRetry={onRetry} retrying={retrying} />
        <TrendPanel trendData={trendData} error={errors.trend} onRetry={onRetry} retrying={retrying} />
      </div>
      <RecentExceptions actionItems={actionItems} canViewWorkCenter={canViewWorkCenter} />
      <DailyOpsReview dailyOps={dailyOps} loading={dailyOpsLoading} error={dailyOpsError} savingKey={dailyOpsSavingKey} canReview={canReviewDailyOps} onMark={onMarkDailyOps} onRetry={onRetry} actionItems={actionItems} riskError={actionItemsError} />
      {canViewReportCenter && <div className="flex justify-end"><Link to="/admin/report-center" className="inline-flex items-center gap-1 text-2xs font-semibold text-blue-600 hover:underline">进入完整报表 <ArrowRight className="h-3 w-3" /></Link></div>}
    </div>
  );
}
