export function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

export function daysUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - start.getTime()) / 86400000);
}

export function isOverdue(value) {
  const days = daysUntil(value);
  return days !== null && days < 0;
}

export function urgencyTone(kind, value) {
  if (kind === 'critical') return 'red';
  if (kind === 'warning') return 'amber';
  if (kind === 'success') return 'green';
  if (value && isOverdue(value)) return 'red';
  return 'blue';
}

export function leadFilterUrl(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const qs = query.toString();
  return qs ? `/admin/leads?${qs}` : '/admin/leads';
}

export const dashboardLeadUrls = {
  availableUnassigned: leadFilterUrl({ assignment: 'unassigned', active: 1 }),
  todayA: leadFilterUrl({ intent: 'A', today_a: 1 }),
  missingPhone: leadFilterUrl({ active: 1, missing_phone: 1 }),
  allA: leadFilterUrl({ intent: 'A' }),
};

export function reportTabUrl(tab) {
  return `/admin/report-center?tab=${encodeURIComponent(tab)}`;
}

export function formatCount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

export function buildDashboardActions({
  helpCount = 0,
  followUps = [],
  scoreItems = [],
  missingPhoneCount = 0,
  staleAItems = [],
  notifyFails = 0,
  canViewSystemSettings = false,
  canViewWorkCenter = false,
  canViewLeadsManage = false,
  canViewScorePreview = false,
  canViewReportCenter = false,
}) {
  const overdueFollowUps = followUps.filter((item) => isOverdue(item.follow_up_date)).length;
  const lowCallAgents = scoreItems.filter((item) =>
    item.signals?.some((signal) => signal.key === 'low_call_activity'),
  ).length;
  const attentionAgents = scoreItems.filter((item) => ['risk', 'watch'].includes(item.level)).length;
  const staleAReviewCount = Array.isArray(staleAItems) ? staleAItems.length : 0;
  const actions = [];

  if (helpCount > 0) {
    actions.push({
      key: 'help',
      title: '求助待处理',
      value: helpCount,
      detail: '话务员标记需要主管介入',
      to: canViewWorkCenter ? '/admin/work-center?queue=help' : '',
      tone: 'red',
    });
  }
  if (overdueFollowUps > 0) {
    actions.push({
      key: 'follow',
      title: '逾期回访',
      value: overdueFollowUps,
      detail: `${overdueFollowUps} 条逾期，${followUps.length} 条未完成回访`,
      to: canViewWorkCenter ? '/admin/work-center?queue=follow' : '',
      tone: 'red',
    });
  }
  if (missingPhoneCount > 0 && canViewLeadsManage) {
    actions.push({
      key: 'missing-phone',
      title: '无电话数据',
      value: missingPhoneCount,
      detail: '导入或存量中缺少电话',
      to: dashboardLeadUrls.missingPhone,
      tone: 'amber',
    });
  }
  if (canViewScorePreview && attentionAgents > 0) {
    actions.push({
      key: 'agent',
      title: '需关注坐席',
      value: attentionAgents,
      detail: `${lowCallAgents} 人低通话量`,
      to: '/admin/score-preview?filter=attention',
      tone: 'amber',
    });
  }
  if (staleAReviewCount > 0 && (canViewWorkCenter || canViewLeadsManage)) {
    actions.push({
      key: 'stale-a',
      title: 'A 级待复盘',
      value: staleAReviewCount,
      detail: '3 天未跟进的高意向线索',
      to: canViewWorkCenter ? '/admin/work-center?queue=stale-a' : leadFilterUrl({ intent: 'A' }),
      tone: 'amber',
    });
  }
  if (notifyFails > 0 && (canViewSystemSettings || canViewReportCenter)) {
    actions.push({
      key: 'notify',
      title: '通知失败',
      value: notifyFails,
      detail: canViewSystemSettings ? 'PushPlus 推送失败需检查配置' : 'PushPlus 推送失败需超管处理',
      to: canViewSystemSettings ? '/admin/settings' : '/admin/report-center?tab=summary',
      tone: 'red',
    });
  }

  return actions;
}

export function buildReportInsights({ trendData, ranking = [] }) {
  const daily = trendData?.daily || [];
  const latest = daily[daily.length - 1];
  const previous = daily[daily.length - 2];
  const bestAgent = [...ranking].sort(
    (a, b) => Number(b.a_to_enroll || 0) - Number(a.a_to_enroll || 0),
  )[0];
  const totalCalls = daily.reduce((sum, item) => sum + Number(item.calls || 0), 0);
  const totalEnroll = daily.reduce((sum, item) => sum + Number(item.enrolled || 0), 0);

  const insights = [];
  if (latest && previous) {
    const diff = Number(latest.calls || 0) - Number(previous.calls || 0);
    insights.push({
      title: diff >= 0 ? '呼出量上升' : '呼出量下降',
      detail: `${latest.date} 比前一日${diff >= 0 ? '增加' : '减少'} ${Math.abs(diff)} 通`,
      tone: diff >= 0 ? 'green' : 'amber',
    });
  }
  if (bestAgent) {
    insights.push({
      title: 'A 转报名最佳',
      detail: `${bestAgent.name} A→报名率 ${bestAgent.a_to_enroll || 0}%`,
      tone: 'blue',
    });
  }
  if (totalCalls > 0) {
    insights.push({
      title: '整体报名效率',
      detail: `当前区间 ${totalCalls} 通，报名 ${totalEnroll} 人`,
      tone: totalEnroll > 0 ? 'green' : 'gray',
    });
  }
  if (insights.length === 0) {
    insights.push({
      title: '暂无管理结论',
      detail: '报表数据加载后会显示趋势和转化提醒',
      tone: 'gray',
    });
  }
  return insights;
}
