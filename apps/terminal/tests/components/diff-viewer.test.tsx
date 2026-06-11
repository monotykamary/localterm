import { fireEvent, render, screen } from "@testing-library/react";
import type { GitDiffResponse } from "@monotykamary/localterm-server/protocol";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DiffViewer } from "../../src/components/diff-viewer";

vi.mock("../../src/utils/fetch-git-diff", () => ({
  fetchGitDiff: vi.fn(),
  fetchGitDiffSummary: vi.fn(),
}));

import { fetchGitDiff } from "../../src/utils/fetch-git-diff";

const fetchGitDiffMock = vi.mocked(fetchGitDiff);

const MODIFIED_PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,3 @@",
  " alpha",
  "-beta",
  "+BETA",
  " gamma",
  "",
].join("\n");

const DIFF_RESPONSE: GitDiffResponse = {
  isRepo: true,
  files: [
    {
      path: "src/app.ts",
      oldPath: null,
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
      patch: MODIFIED_PATCH,
      patchOmitted: false,
    },
    {
      path: "image.png",
      oldPath: null,
      status: "modified",
      additions: 0,
      deletions: 0,
      binary: true,
      patch: null,
      patchOmitted: false,
    },
  ],
};

const renderDiffViewer = (onClose: () => void = () => {}) =>
  render(<DiffViewer open cwd="/repo" onClose={onClose} />);

afterEach(() => {
  fetchGitDiffMock.mockReset();
});

describe("DiffViewer", () => {
  it("renders the file list and auto-selects the first file", async () => {
    fetchGitDiffMock.mockResolvedValue(DIFF_RESPONSE);
    renderDiffViewer();

    const fileOption = await screen.findByRole("option", { name: /app\.ts/ });
    expect(fileOption.getAttribute("aria-selected")).toBe("true");
    expect(fetchGitDiffMock).toHaveBeenCalledWith("/repo", expect.any(AbortSignal));

    expect(await screen.findByText("beta")).toBeTruthy();
    expect(screen.getByText("BETA")).toBeTruthy();
    expect(screen.getByText("@@ -1,3 +1,3 @@")).toBeTruthy();
  });

  it("shows a binary notice when a binary file is selected", async () => {
    fetchGitDiffMock.mockResolvedValue(DIFF_RESPONSE);
    renderDiffViewer();

    const binaryOption = await screen.findByRole("option", { name: /image\.png/ });
    fireEvent.click(binaryOption);
    expect(await screen.findByText(/Binary file/)).toBeTruthy();
  });

  it("switches between unified and split layouts", async () => {
    fetchGitDiffMock.mockResolvedValue(DIFF_RESPONSE);
    renderDiffViewer();
    await screen.findByText("BETA");

    const splitToggle = screen.getByRole("radio", { name: "split" });
    fireEvent.click(splitToggle);
    expect(splitToggle.getAttribute("aria-checked")).toBe("true");
    // Context lines render on both sides in split view.
    expect(screen.getAllByText("alpha")).toHaveLength(2);

    fireEvent.click(screen.getByRole("radio", { name: "unified" }));
    expect(screen.getAllByText("alpha")).toHaveLength(1);
  });

  it("closes on Escape", async () => {
    fetchGitDiffMock.mockResolvedValue(DIFF_RESPONSE);
    const onClose = vi.fn();
    renderDiffViewer(onClose);
    await screen.findByText("BETA");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports a non-repo directory", async () => {
    fetchGitDiffMock.mockResolvedValue({ isRepo: false, files: [] });
    renderDiffViewer();
    expect(await screen.findByText(/Not a git repository/)).toBeTruthy();
  });

  it("reports a clean working tree", async () => {
    fetchGitDiffMock.mockResolvedValue({ isRepo: true, files: [] });
    renderDiffViewer();
    expect(await screen.findByText(/Working tree clean/)).toBeTruthy();
  });

  it("offers a retry when the diff fails to load", async () => {
    fetchGitDiffMock.mockResolvedValue(null);
    renderDiffViewer();
    expect(await screen.findByText(/Couldn't load the diff/)).toBeTruthy();

    fetchGitDiffMock.mockResolvedValue(DIFF_RESPONSE);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("BETA")).toBeTruthy();
  });
});
