import type { GitBranchPr } from "@monotykamary/localterm-server/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MERGED_PR_OVERLAY_TTL_MS } from "@/lib/constants";
import { resolvePrDisplayState } from "@/lib/pr-state";

const basePr = (overrides: Partial<GitBranchPr>): GitBranchPr => ({
  number: 1,
  title: "PR",
  baseRefName: "main",
  baseRef: "origin/main",
  url: null,
  state: "open",
  isDraft: false,
  mergeable: "unknown",
  mergedAt: null,
  ...overrides,
});

describe("resolvePrDisplayState", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("maps open/draft/conflicting/closed PRs to their display state", () => {
    vi.setSystemTime(new Date("2026-06-19T00:00:00Z"));
    expect(resolvePrDisplayState(basePr({ state: "open" }), "main")).toBe("open");
    expect(resolvePrDisplayState(basePr({ state: "open", isDraft: true }), "main")).toBe("draft");
    expect(resolvePrDisplayState(basePr({ state: "open", mergeable: "conflicting" }), "main")).toBe(
      "conflicting",
    );
    expect(resolvePrDisplayState(basePr({ state: "closed" }), "main")).toBe("closed");
  });

  it("surfaces a recently merged PR on a base branch", () => {
    vi.setSystemTime(new Date("2026-06-19T00:00:00Z"));
    const mergedAt = new Date("2026-06-18T00:00:00Z").toISOString();
    expect(resolvePrDisplayState(basePr({ state: "merged", mergedAt }), "main")).toBe("merged");
  });

  it("hides a merged PR on a base branch once older than the overlay TTL", () => {
    vi.setSystemTime(new Date("2026-06-19T00:00:00Z"));
    const justOverTtlAgo = new Date(
      new Date("2026-06-19T00:00:00Z").getTime() - MERGED_PR_OVERLAY_TTL_MS - 1,
    ).toISOString();
    expect(
      resolvePrDisplayState(basePr({ state: "merged", mergedAt: justOverTtlAgo }), "main"),
    ).toBeNull();
  });

  it("matches base branches case-insensitively and via their tracking ref", () => {
    vi.setSystemTime(new Date("2026-06-19T00:00:00Z"));
    const stale = new Date(
      new Date("2026-06-19T00:00:00Z").getTime() - MERGED_PR_OVERLAY_TTL_MS - 1,
    ).toISOString();
    expect(
      resolvePrDisplayState(basePr({ state: "merged", mergedAt: stale }), "origin/main"),
    ).toBeNull();
    expect(
      resolvePrDisplayState(basePr({ state: "merged", mergedAt: stale }), "production"),
    ).toBeNull();
    expect(resolvePrDisplayState(basePr({ state: "merged", mergedAt: stale }), "MAIN")).toBeNull();
  });

  it("keeps a merged PR on a base branch visible at exactly the TTL boundary", () => {
    vi.setSystemTime(new Date("2026-06-19T00:00:00Z"));
    const atTtlBoundary = new Date(
      new Date("2026-06-19T00:00:00Z").getTime() - MERGED_PR_OVERLAY_TTL_MS,
    ).toISOString();
    expect(
      resolvePrDisplayState(basePr({ state: "merged", mergedAt: atTtlBoundary }), "main"),
    ).toBe("merged");
  });

  it("keeps a stale merged PR visible on a feature branch", () => {
    vi.setSystemTime(new Date("2026-06-19T00:00:00Z"));
    const stale = new Date(
      new Date("2026-06-19T00:00:00Z").getTime() - MERGED_PR_OVERLAY_TTL_MS - 1,
    ).toISOString();
    expect(
      resolvePrDisplayState(basePr({ state: "merged", mergedAt: stale }), "feature/add-login"),
    ).toBe("merged");
  });

  it("treats a merged PR with no timestamp as visible (cannot prove staleness)", () => {
    vi.setSystemTime(new Date("2026-06-19T00:00:00Z"));
    expect(resolvePrDisplayState(basePr({ state: "merged", mergedAt: null }), "main")).toBe(
      "merged",
    );
  });
});
