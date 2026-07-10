const CST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatUtcDate(value) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function cstParts(now) {
  return Object.fromEntries(
    CST_FORMATTER.formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function shiftDate(value, days) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text)
    ? '"' + text.replace(/"/g, '""') + '"'
    : text;
}

export function getCstCalendarRange(mode, now = new Date()) {
  const { year, month, day } = cstParts(now);
  const end = new Date(Date.UTC(year, month - 1, day));
  const start = new Date(end);

  if (mode === "week") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  } else {
    start.setUTCDate(1);
  }

  return {
    start_date: formatUtcDate(start),
    end_date: formatUtcDate(end),
  };
}

export function validateTrendRange(start, end) {
  if (!start || !end) return "请选择开始和结束日期";
  if (start > end) return "开始日期不能晚于结束日期";

  const startMs = Date.parse(start + "T00:00:00Z");
  const endMs = Date.parse(end + "T00:00:00Z");
  if ((endMs - startMs) / 86400000 + 1 > 366) {
    return "查询范围最多 366 天";
  }

  return "";
}

export function normalizeTrendData(payload = {}) {
  const sourceDaily = Array.isArray(payload.daily) ? payload.daily : [];
  const usesIdContract = Array.isArray(payload.agents);
  const agents = usesIdContract
    ? payload.agents.map((agent) => ({
        id: agent.id,
        key: String(agent.id),
        name: agent.name,
        isActive: Boolean(agent.is_active),
        seriesKey: "agent_" + agent.id,
      }))
    : [
        ...new Set(
          sourceDaily.flatMap((row) => Object.keys(row.agent_calls || {})),
        ),
      ].map((name, index) => ({
        id: null,
        key: "legacy:" + name,
        name,
        isActive: true,
        seriesKey: "agent_legacy_" + index,
      }));

  const callsByDate = Object.fromEntries(
    sourceDaily.map((row) => [row.date, Number(row.calls || 0)]),
  );
  const daily = sourceDaily.map((row) => {
    const normalized = {
      ...row,
      calls: Number(row.calls || 0),
      enrolled: Number(row.enrolled || 0),
      prev_calls: row.prev_calls ?? callsByDate[shiftDate(row.date, -7)] ?? null,
    };

    agents.forEach((agent) => {
      const source = usesIdContract
        ? row.agent_calls_by_id
        : row.agent_calls;
      const sourceKey = agent.key.replace("legacy:", "");
      normalized[agent.seriesKey] = Number(source?.[sourceKey] || 0);
    });

    return normalized;
  });

  return {
    agents,
    daily,
    start: payload.start || "",
    end: payload.end || "",
  };
}

export function getActiveTrendAgents(daily, agents) {
  return agents.filter((agent) =>
    daily.some((row) => Number(row[agent.seriesKey] || 0) > 0),
  );
}

export function buildTrendCsv(daily, agents) {
  const header = [
    "日期",
    "呼出量",
    "报名数",
    ...agents.map((agent) => agent.name),
  ];
  const rows = daily.map((row) => [
    row.date,
    row.calls,
    row.enrolled,
    ...agents.map((agent) => row[agent.seriesKey] || 0),
  ]);

  return (
    "\ufeff" +
    [header, ...rows]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\r\n")
  );
}
