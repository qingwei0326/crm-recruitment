import { describe, expect, it } from "vitest";
import {
  buildTrendCsv,
  getActiveTrendAgents,
  getCstCalendarRange,
  normalizeTrendData,
  validateTrendRange,
} from "../trendReportUtils";

describe("trendReportUtils", () => {
  it("normalizes ID keyed data and drops zero-total agents", () => {
    const normalized = normalizeTrendData({
      start: "2026-07-10",
      end: "2026-07-10",
      agents: [
        { id: 14, name: "邹欣辰", is_active: true },
        { id: 15, name: "离职无数据", is_active: false },
      ],
      daily: [
        {
          date: "2026-07-10",
          calls: 3,
          enrolled: 0,
          prev_calls: 1,
          agent_calls_by_id: { 14: 3, 15: 0 },
        },
      ],
    });

    expect(normalized.agents.map((agent) => agent.seriesKey)).toEqual([
      "agent_14",
      "agent_15",
    ]);
    expect(normalized.daily[0].agent_14).toBe(3);
    expect(normalized.daily[0].agent_15).toBe(0);
    expect(
      getActiveTrendAgents(normalized.daily, normalized.agents).map(
        (agent) => agent.id,
      ),
    ).toEqual([14]);
  });

  it("normalizes legacy names to safe keys and derives missing comparison data", () => {
    const normalized = normalizeTrendData({
      daily: [
        {
          date: "2026-07-03",
          calls: 2,
          enrolled: 0,
          agent_calls: { "张.三,一组": 2 },
        },
        {
          date: "2026-07-10",
          calls: 4,
          enrolled: 0,
          agent_calls: { "张.三,一组": 4 },
        },
      ],
    });

    expect(normalized.agents[0]).toMatchObject({
      key: "legacy:张.三,一组",
      name: "张.三,一组",
      seriesKey: "agent_legacy_0",
    });
    expect(normalized.daily[1].agent_legacy_0).toBe(4);
    expect(normalized.daily[1].prev_calls).toBe(2);
  });

  it("builds natural CST week and month ranges across the UTC date boundary", () => {
    const now = new Date("2026-07-05T16:30:00Z");

    expect(getCstCalendarRange("week", now)).toEqual({
      start_date: "2026-07-06",
      end_date: "2026-07-06",
    });
    expect(getCstCalendarRange("month", now)).toEqual({
      start_date: "2026-07-01",
      end_date: "2026-07-06",
    });
  });

  it("validates required, ordered, and bounded custom ranges", () => {
    expect(validateTrendRange("", "2026-07-10")).toBe(
      "请选择开始和结束日期",
    );
    expect(validateTrendRange("2026-07-11", "2026-07-10")).toBe(
      "开始日期不能晚于结束日期",
    );
    expect(validateTrendRange("2025-07-09", "2026-07-10")).toBe(
      "查询范围最多 366 天",
    );
    expect(validateTrendRange("2026-07-01", "2026-07-10")).toBe("");
  });

  it("exports totals and all positive-agent columns with CSV escaping", () => {
    const agents = [
      { id: 14, name: "张,三", seriesKey: "agent_14" },
      { id: 15, name: "李\"四\n二组", seriesKey: "agent_15" },
    ];
    const csv = buildTrendCsv(
      [
        {
          date: "2026-07-10",
          calls: 5,
          enrolled: 1,
          agent_14: 2,
          agent_15: 3,
        },
      ],
      agents,
    );

    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('日期,呼出量,报名数,"张,三","李""四\n二组"');
    expect(csv).toContain("2026-07-10,5,1,2,3");
  });
});
