import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { GitBranchInfo } from "@monotykamary/localterm-server/protocol";
import { GIT_PR_INLINE_FRESH_MS } from "../../src/lib/constants";

vi.mock("../../src/utils/fetch-git-diff", () => ({
  fetchGitBranches: vi.fn(),
  fetchGitBranchPr: vi.fn(),
}));

import { fetchGitBranches, fetchGitBranchPr } from "../../src/utils/fetch-git-diff";
import { useGitBranchInfo } from "../../src/hooks/use-git-branch-info";

const branchesMock = vi.mocked(fetchGitBranches);
const prMock = vi.mocked(fetchGitBranchPr);

const BRANCH_INFO: GitBranchInfo = {
  isRepo: true,
  currentBranch: "feature",
  defaultBase: "origin/main",
  defaultBaseSource: "remoteHead",
  branches: ["origin/main", "feature"],
  pr: null,
};

const waitForBranchLease = async (result: { current: ReturnType<typeof useGitBranchInfo> }) => {
  await vi.waitFor(() => {
    expect(result.current.branchInfo?.currentBranch).toBe("feature");
  });
};

describe("useGitBranchInfo inline PR set", () => {
  beforeEach(() => {
    branchesMock.mockReset();
    prMock.mockReset();
    branchesMock.mockResolvedValue({ ...BRANCH_INFO });
    prMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inline-sets the PR from a creation URL, seeding base from the leased default", async () => {
    const { result } = renderHook(() => useGitBranchInfo("/repo"));
    await waitForBranchLease(result);

    act(() => {
      result.current.notePrCreated("https://github.com/foo/bar/pull/42");
    });

    expect(result.current.branchInfo?.pr).toEqual({
      number: 42,
      title: "",
      baseRefName: "main",
      baseRef: "origin/main",
      url: "https://github.com/foo/bar/pull/42",
      state: "open",
    });
  });

  it("falls back to a full re-lease when the default base is not leased yet", async () => {
    branchesMock.mockResolvedValue(null);
    const { result } = renderHook(() => useGitBranchInfo("/repo"));
    await vi.waitFor(() => expect(branchesMock).toHaveBeenCalled());

    const callsBefore = branchesMock.mock.calls.length;
    act(() => {
      result.current.notePrCreated("https://github.com/foo/bar/pull/42");
    });

    expect(branchesMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("refreshUnlessFresh skips while an inline set is fresh", async () => {
    const { result } = renderHook(() => useGitBranchInfo("/repo"));
    await waitForBranchLease(result);

    act(() => {
      result.current.notePrCreated("https://github.com/foo/bar/pull/42");
    });
    const callsAfterInline = branchesMock.mock.calls.length;

    act(() => {
      result.current.refreshUnlessFresh();
    });
    expect(branchesMock.mock.calls.length).toBe(callsAfterInline);
  });

  it("refreshUnlessFresh re-leases once the inline set is stale", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    const { result } = renderHook(() => useGitBranchInfo("/repo"));
    await waitForBranchLease(result);

    act(() => {
      result.current.notePrCreated("https://github.com/foo/bar/pull/42");
    });
    const callsAfterInline = branchesMock.mock.calls.length;

    const setAt = nowSpy.mock.results.at(-1)?.value as number;
    nowSpy.mockReturnValue(setAt + GIT_PR_INLINE_FRESH_MS + 1);
    act(() => {
      result.current.refreshUnlessFresh();
    });

    expect(branchesMock.mock.calls.length).toBeGreaterThan(callsAfterInline);
  });
});
