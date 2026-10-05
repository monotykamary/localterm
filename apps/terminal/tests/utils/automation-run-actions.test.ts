import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { triggerAutomationRun } from "../../src/utils/trigger-automation-run";
import { cancelAutomationRun } from "../../src/utils/cancel-automation-run";
import { automationRunReason } from "../../src/utils/automation-run-reason";
import { runStatusBadge } from "../../src/utils/run-status-badge";
import { runFixture } from "../fixtures/automation";

afterEach(() => vi.unstubAllGlobals());
describe("automation run actions", () => {
  it.each(["queued", "skipped", "running"])("preserves %s run-now receipts", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ runId: "run-1", status }))),
    );
    expect(await triggerAutomationRun("a/b")).toEqual({ runId: "run-1", status });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("a%2Fb/run");
  });
  it("does not claim a launch for malformed or failed responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    expect(await triggerAutomationRun("a")).toBeNull();
  });
  it.each([
    [200, "cancelled"],
    [409, "not-queued"],
    [500, "error"],
  ] as const)("handles cancellation HTTP %s", async (status, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    expect(await cancelAutomationRun("a/b", "r/x")).toBe(expected);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("a%2Fb/runs/r%2Fx/cancel");
  });
  it("explains reasons without guessing downtime and flags interruption", () => {
    expect(automationRunReason(runFixture({ status: "skipped", reason: "overlap" }))).toMatch(
      /busy/,
    );
    expect(automationRunReason(runFixture({ status: "skipped" }))).toBeNull();
    expect(automationRunReason(runFixture({ status: "interrupted", reason: "restart" }))).toMatch(
      /restarted/,
    );
    expect(runStatusBadge("interrupted", null).label).toContain("needs attention");
    expect(runStatusBadge("queued", null).label).toContain("waiting");
    expect(runStatusBadge("cancelled", null).label).toBe("cancelled");
  });
});
