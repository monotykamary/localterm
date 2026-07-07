import { describe, expect, it } from "vite-plus/test";
import { triageDateBandLabel } from "../../src/utils/triage-date-bands";

// Local noon keeps every offset below mid-day, so a ±1h daylight-saving swing
// can never push a timestamp across a midnight boundary and flip its band.
const nowMs = new Date(2026, 6, 7, 12, 0, 0).getTime();
const hoursAgo = (hours: number): number => nowMs - hours * 3_600_000;

describe("triageDateBandLabel", () => {
  it("labels anything from the start of today (including the future) as Today", () => {
    expect(triageDateBandLabel(nowMs, nowMs)).toBe("Today");
    expect(triageDateBandLabel(hoursAgo(1), nowMs)).toBe("Today");
    expect(triageDateBandLabel(nowMs + 3_600_000, nowMs)).toBe("Today");
  });

  it("labels the previous calendar day as Yesterday", () => {
    // 28h before local noon = 08:00 the previous day.
    expect(triageDateBandLabel(hoursAgo(28), nowMs)).toBe("Yesterday");
  });

  it("labels 2–7 days ago as This week", () => {
    // 76h before local noon = 08:00 three days ago.
    expect(triageDateBandLabel(hoursAgo(76), nowMs)).toBe("This week");
  });

  it("labels anything older than the rolling week as Earlier", () => {
    // 196h before local noon = 08:00 eight days ago.
    expect(triageDateBandLabel(hoursAgo(196), nowMs)).toBe("Earlier");
  });
});
