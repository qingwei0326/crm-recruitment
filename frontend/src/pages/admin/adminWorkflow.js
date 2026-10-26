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
