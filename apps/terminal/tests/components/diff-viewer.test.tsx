import { fireEvent, render, screen } from "@testing-library/react";
import type {
  GitBranchInfo,
  GitDiffFileListResponse,
  GitDiffFilePatch,
} from "@monotykamary/localterm-server/protocol";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DiffViewer } from "../../src/components/diff-viewer";

vi.mock("../../src/utils/fetch-git-diff", () => ({
  fetchGitDiffFiles: vi.fn(),
  fetchGitDiffFilePatch: vi.fn(),
}));

import { fetchGitDiffFilePatch, fetchGitDiffFiles } from "../../src/utils/fetch-git-diff";

const filesMock = vi.mocked(fetchGitDiffFiles);
const patchMock = vi.mocked(fetchGitDiffFilePatch);

const BRANCH_INFO: GitBranchInfo = {
  isRepo: true,
  currentBranch: "feature",
  defaultBase: "origin/main",
  defaultBaseSource: "pr",
  branches: ["origin/main", "feature", "origin/develop"],
  pr: {
    number: 123,
    title: "Add diff modes",
    baseRefName: "main",
    url: "https://example.test/pr/123",
    state: "open",
  },
};

const MODIFIED_PATCH = [
  "@@ -1,3 +1,3 @@",
  " alpha",
  "-beta",
  "+BETA",
  " gamma",
  "",
].join("\n");

const FILE_LIST: GitDiffFileListResponse = {
  isRepo: true,
  files: [
    {
      path: "src/app.ts",
      oldPath: null,
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
    },
    {
      path: "image.png",
      oldPath: null,
      status: "modified",
      additions: 0,
      deletions: 0,
      binary: true,
    },
  ],
};

const PATCHES: Record<string, GitDiffFilePatch> = {
  "src/app.ts": { patch: MODIFIED_PATCH, patchOmitted: false, binary: false },
  "image.png": { patch: null, patchOmitted: false, binary: true },
};

// Default happy path: a two-file list whose patches resolve from PATCHES.
const mockHappyPath = () => {
  filesMock.mockResolvedValue(FILE_LIST);
  patchMock.mockImplementation((_cwd, path) => Promise.resolve(PATCHES[path] ?? null));
};

// branchInfo is leased by the parent and passed in as a prop; tests pass it
// directly (null = no PR / not loaded).
const renderDiffViewer = (
  { onClose = () => {}, branchInfo = null }: { onClose?: () => void; branchInfo?: GitBranchInfo | null } = {},
) => render(<DiffViewer open cwd="/repo" branchInfo={branchInfo} onClose={onClose} />);

afterEach(() => {
  filesMock.mockReset();
  patchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("DiffViewer", () => {
  it("renders the file list and auto-selects the first file", async () => {
    mockHappyPath();
    renderDiffViewer();

    const fileOption = await screen.findByRole("option", { name: /app\.ts/, selected: true });
    expect(fileOption).toBeTruthy();
    expect(filesMock).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({ mode: "working" }),
      expect.any(AbortSignal),
    );

    expect(await screen.findByText("beta")).toBeTruthy();
    expect(screen.getByText("BETA")).toBeTruthy();
    expect(screen.getByText("@@ -1,3 +1,3 @@")).toBeTruthy();
  });

  it("shows a binary notice when a binary file is selected", async () => {
    mockHappyPath();
    renderDiffViewer();

    const binaryOption = await screen.findByRole("option", { name: /image\.png/ });
    fireEvent.click(binaryOption);
    expect(await screen.findByText(/Binary file/)).toBeTruthy();
  });

  it("switches between unified and split layouts", async () => {
    mockHappyPath();
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
    mockHappyPath();
    const onClose = vi.fn();
    renderDiffViewer({ onClose });
    await screen.findByText("BETA");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports a non-repo directory", async () => {
    filesMock.mockResolvedValue({ isRepo: false, files: [] });
    renderDiffViewer();
    expect(await screen.findByText(/Not a git repository/)).toBeTruthy();
  });

  it("reports a clean working tree", async () => {
    filesMock.mockResolvedValue({ isRepo: true, files: [] });
    renderDiffViewer();
    expect(await screen.findByText(/Working tree clean/)).toBeTruthy();
  });

  it("offers a retry when the file list fails to load", async () => {
    filesMock.mockResolvedValue(null);
    renderDiffViewer();
    expect(await screen.findByText(/Couldn't load the diff/)).toBeTruthy();

    mockHappyPath();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("BETA")).toBeTruthy();
  });

  it("fetches each file's patch once and caches it across re-selection", async () => {
    mockHappyPath();
    renderDiffViewer();
    await screen.findByText("BETA");

    // image.png is prefetched as app.ts's neighbor; selecting it is a cache hit.
    fireEvent.click(await screen.findByRole("option", { name: /image\.png/ }));
    await screen.findByText(/Binary file/);
    fireEvent.click(screen.getByRole("option", { name: /app\.ts/ }));
    await screen.findByText("BETA");

    const appCalls = patchMock.mock.calls.filter(([, path]) => path === "src/app.ts");
    const imageCalls = patchMock.mock.calls.filter(([, path]) => path === "image.png");
    expect(appCalls).toHaveLength(1);
    expect(imageCalls).toHaveLength(1);
  });

  it("retries a failed per-file patch fetch", async () => {
    filesMock.mockResolvedValue(FILE_LIST);
    let appAttempts = 0;
    patchMock.mockImplementation((_cwd, path) => {
      if (path === "src/app.ts") {
        appAttempts += 1;
        return Promise.resolve(appAttempts === 1 ? null : PATCHES["src/app.ts"]);
      }
      return Promise.resolve(PATCHES[path] ?? null);
    });
    renderDiffViewer();

    expect(await screen.findByText(/Couldn't load this file's diff/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("BETA")).toBeTruthy();
  });

  it("opens the editor from a line and saves an annotation", async () => {
    mockHappyPath();
    renderDiffViewer();
    await screen.findByText("BETA");

    // Each diff line carries a (CSS-hidden) annotate button; clicking one opens
    // the editor for that line — exercises the memoized line → editor wiring.
    fireEvent.click(screen.getAllByLabelText(/comment on line/)[0]);
    const textarea = await screen.findByLabelText("line comment");
    fireEvent.change(textarea, { target: { value: "looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));

    expect(await screen.findByText("looks good")).toBeTruthy();
    expect(screen.getByText(/1 pending comment/)).toBeTruthy();
  });

  it("caps the first paint of a large diff and shows a progress indicator", async () => {
    // Freeze animation frames so the progressive grow can't advance — this pins
    // the first-paint state: only the first chunk is mounted, the tail is not,
    // and the "rendering more lines" indicator is shown.
    vi.stubGlobal("requestAnimationFrame", () => 0);

    const lineCount = 2500;
    const patch = [
      `@@ -0,0 +1,${lineCount} @@`,
      ...Array.from({ length: lineCount }, (_, i) => `+line ${i}`),
      "",
    ].join("\n");
    filesMock.mockResolvedValue({
      isRepo: true,
      files: [
        {
          path: "big.txt",
          oldPath: null,
          status: "added",
          additions: lineCount,
          deletions: 0,
          binary: false,
        },
      ],
    });
    patchMock.mockResolvedValue({ patch, patchOmitted: false, binary: false });
    renderDiffViewer();

    // First chunk (line 0) paints immediately; the tail (last line) does not.
    expect(await screen.findByText("line 0")).toBeTruthy();
    expect(screen.queryByText(`line ${lineCount - 1}`)).toBeNull();
    expect(screen.getByText(/rendering .* more lines/)).toBeTruthy();
  });

  it("auto-switches to branch mode when the leased branchInfo has a PR", async () => {
    mockHappyPath();
    renderDiffViewer({ branchInfo: BRANCH_INFO });

    // No manual toggle — the leased PR derives branch mode immediately.
    await vi.waitFor(() =>
      expect(screen.getByRole("radio", { name: "Branch" }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
    // Base picker preselects the leased default; the PR is surfaced distinctly.
    const baseSelect = (await screen.findByLabelText("base branch")) as HTMLSelectElement;
    expect(baseSelect.value).toBe("origin/main");
    expect(screen.getByText("#123")).toBeTruthy();

    // The branch diff is fetched without a base override — the server resolves
    // the default base locally, so the diff never waits on gh.
    await vi.waitFor(() =>
      expect(filesMock).toHaveBeenCalledWith(
        "/repo",
        expect.objectContaining({ mode: "branch" }),
        expect.any(AbortSignal),
      ),
    );
  });

  it("re-fetches against a user-picked base branch", async () => {
    mockHappyPath();
    renderDiffViewer({ branchInfo: BRANCH_INFO });

    const baseSelect = (await screen.findByLabelText("base branch")) as HTMLSelectElement;
    fireEvent.change(baseSelect, { target: { value: "origin/develop" } });

    await vi.waitFor(() =>
      expect(filesMock).toHaveBeenCalledWith(
        "/repo",
        expect.objectContaining({ mode: "branch", base: "origin/develop" }),
        expect.any(AbortSignal),
      ),
    );
  });

  it("keeps the PR badge visible after switching to working mode", async () => {
    mockHappyPath();
    renderDiffViewer({ branchInfo: BRANCH_INFO });

    // Derived to branch; the user switches back to working.
    await screen.findByLabelText("base branch");
    fireEvent.click(screen.getByRole("radio", { name: "Working" }));

    // The base picker is branch-only, but the PR badge stays as an indicator.
    expect(screen.queryByLabelText("base branch")).toBeNull();
    expect(screen.getByText("#123")).toBeTruthy();
  });

  it("stays in working mode when there is no PR", async () => {
    mockHappyPath();
    renderDiffViewer({ branchInfo: { ...BRANCH_INFO, pr: null } });
    await screen.findByText("BETA");

    expect(screen.getByRole("radio", { name: "Working" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("#123")).toBeNull();
  });
});
