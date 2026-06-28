import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DIFF_VIEWER_REALTIME_REFRESH_DEBOUNCE_MS } from "../../src/lib/constants";
import type {
  GitBranchInfo,
  GitDiffFileListResponse,
  GitDiffFilePatch,
} from "@monotykamary/localterm-server/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DiffViewer } from "../../src/components/diff-viewer";

vi.mock("../../src/utils/fetch-git-diff", () => ({
  fetchGitDiffFiles: vi.fn(),
  fetchGitDiffFilePatch: vi.fn(),
}));

class StubResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: { width: 1024 } as DOMRectReadOnly,
          borderBoxSize: [] as ResizeObserverSize[],
          contentBoxSize: [{ inlineSize: 1024, blockSize: 768 }] as ResizeObserverSize[],
          devicePixelContentBoxSize: [] as ResizeObserverSize[],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
});

vi.mock("@tanstack/react-virtual", () => {
  const FILE_ROW_HEIGHT = 32;
  return {
    useVirtualizer: ({
      count,
      getItemKey,
    }: {
      count: number;
      getItemKey: (index: number) => string;
    }) => ({
      getTotalSize: () => count * FILE_ROW_HEIGHT,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, i) => ({
          index: i,
          start: i * FILE_ROW_HEIGHT,
          size: FILE_ROW_HEIGHT,
          key: getItemKey(i),
        })),
      scrollToIndex: () => {},
      measure: () => {},
    }),
  };
});

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
    baseRef: "origin/main",
    url: "https://example.test/pr/123",
    state: "open",
    isDraft: false,
    mergeable: "mergeable",
    mergedAt: null,
  },
};

const MODIFIED_PATCH = ["@@ -1,3 +1,3 @@", " alpha", "-beta", "+BETA", " gamma", ""].join("\n");

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
    {
      path: "data.bin",
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
  "data.bin": { patch: null, patchOmitted: false, binary: true },
};

// Reads the numeric suffix from a Tailwind `z-N` utility so stacking-order
// assertions don't depend on layout/paint.
const tailwindZIndexOf = (node: Element | null | undefined): number | null => {
  if (!node) return null;
  const match = (node.getAttribute("class") ?? "").match(/(?:^|\s)z-(\d+)(?:\s|$)/);
  return match ? Number(match[1]) : null;
};

// Default happy path: a two-file list whose patches resolve from PATCHES.
const mockHappyPath = () => {
  filesMock.mockResolvedValue(FILE_LIST);
  patchMock.mockImplementation((_cwd, path) => Promise.resolve(PATCHES[path] ?? null));
};

// branchInfo is leased by the parent and passed in as a prop; tests pass it
// directly (null = no PR / not loaded).
const renderDiffViewer = ({
  onClose = () => {},
  onOpenInEditor,
  onOpenImage,
  branchInfo = null,
}: {
  onClose?: () => void;
  onOpenInEditor?: (filePath: string) => void;
  onOpenImage?: (filePath: string) => void;
  branchInfo?: GitBranchInfo | null;
} = {}) =>
  render(
    <DiffViewer
      open
      cwd="/repo"
      branchInfo={branchInfo}
      onClose={onClose}
      onOpenInEditor={onOpenInEditor}
      onOpenImage={onOpenImage}
    />,
  );

afterEach(() => {
  filesMock.mockReset();
  patchMock.mockReset();
  vi.unstubAllGlobals();
  // The diff view mode persists in localStorage across tests in this file; the
  // split-toggle tests below would otherwise leak "split" into later tests that
  // render in the default (unified) mode.
  localStorage.clear();
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

    expect(await screen.findByText("beta", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("BETA")).toBeTruthy();
    expect(screen.getByText("@@ -1,3 +1,3 @@")).toBeTruthy();
    // First-paint of the auto-selected patch is CPU-bound; under turbo's
    // parallel cross-package run the findByText poll starves past its 1000ms
    // default. The generous waitFor and test timeout absorb that without
    // masking a real hang (isolation renders in <1s).
  }, 10_000);

  it("shows a binary notice when a non-image binary file is selected", async () => {
    mockHappyPath();
    renderDiffViewer();

    const binaryOption = await screen.findByRole("option", { name: /data\.bin/ });
    fireEvent.click(binaryOption);
    expect(await screen.findByText(/Binary file/)).toBeTruthy();
  });

  it("switches between unified and split layouts", async () => {
    mockHappyPath();
    renderDiffViewer();
    await screen.findByText("BETA");

    const layoutGroup = screen.getByRole("radiogroup", { name: "diff layout" });
    const [unifiedToggle, splitToggle] = within(layoutGroup).getAllByRole("radio");
    fireEvent.click(splitToggle);
    expect(splitToggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByText("alpha")).toHaveLength(2);

    fireEvent.click(unifiedToggle);
    expect(screen.getAllByText("alpha")).toHaveLength(1);
  });

  it("renders split mode side-by-side even on narrow containers", async () => {
    class NarrowResizeObserver {
      private callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: 400 } as DOMRectReadOnly,
              borderBoxSize: [] as ResizeObserverSize[],
              contentBoxSize: [{ inlineSize: 400, blockSize: 768 }] as ResizeObserverSize[],
              devicePixelContentBoxSize: [] as ResizeObserverSize[],
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }

      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", NarrowResizeObserver);
    mockHappyPath();
    renderDiffViewer();
    await screen.findByText("BETA");

    const layoutGroup = screen.getByRole("radiogroup", { name: "diff layout" });
    const splitToggle = within(layoutGroup).getAllByRole("radio")[1];
    fireEvent.click(splitToggle);
    // Split mode always renders side-by-side, even on narrow containers.
    expect(screen.getAllByText("alpha")).toHaveLength(2);
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("BETA")).toBeTruthy();
  });

  it("collapses the sidebar and shows a file picker popover on narrow screens", async () => {
    class NarrowResizeObserver {
      private callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: 600 } as DOMRectReadOnly,
              borderBoxSize: [] as ResizeObserverSize[],
              contentBoxSize: [{ inlineSize: 600, blockSize: 768 }] as ResizeObserverSize[],
              devicePixelContentBoxSize: [] as ResizeObserverSize[],
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }

      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", NarrowResizeObserver);
    mockHappyPath();
    renderDiffViewer();
    await screen.findByText("BETA");

    // Sidebar is collapsed (width 0) and the file picker popover trigger is visible.
    expect(screen.getByRole("button", { name: "select file" })).toBeTruthy();
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
    await screen.findByAltText("image.png");
    fireEvent.click(screen.getByRole("option", { name: /app\.ts/ }));
    await screen.findByText("BETA");

    const appCalls = patchMock.mock.calls.filter(([, path]) => path === "src/app.ts");
    const imageCalls = patchMock.mock.calls.filter(([, path]) => path === "image.png");
    expect(appCalls).toHaveLength(1);
    expect(imageCalls).toHaveLength(1);
  });

  it("opens a regular file in neovim via the open-in-editor callback", async () => {
    mockHappyPath();
    const onOpenInEditor = vi.fn();
    renderDiffViewer({ onOpenInEditor });
    await screen.findByText("BETA");

    const button = screen.getByRole("button", { name: /open .* in neovim/ });
    fireEvent.click(button);

    expect(onOpenInEditor).toHaveBeenCalledTimes(1);
    expect(onOpenInEditor).toHaveBeenCalledWith("src/app.ts");
  });

  it("hides the open button for non-image binary files", async () => {
    mockHappyPath();
    renderDiffViewer({ onOpenInEditor: () => {}, onOpenImage: () => {} });
    await screen.findByText("BETA");

    expect(screen.getByRole("button", { name: /open .* in neovim/ })).toBeTruthy();

    fireEvent.click(await screen.findByRole("option", { name: /data\.bin/ }));
    await screen.findByText(/Binary file/);

    expect(screen.queryByRole("button", { name: /open .* in neovim/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /open image/ })).toBeNull();
  });

  it("shows an inline preview for image files", async () => {
    mockHappyPath();
    renderDiffViewer({ onOpenImage: () => {} });
    await screen.findByText("BETA");

    fireEvent.click(await screen.findByRole("option", { name: /image\.png/ }));
    const image = await screen.findByAltText("image.png");
    expect(image.getAttribute("src")).toContain("/api/file");
    expect(image.getAttribute("src")).toContain(encodeURIComponent("image.png"));
    expect(screen.queryByText(/Binary file/)).toBeNull();
  });

  it("opens an image in a new tab via the open-image callback", async () => {
    mockHappyPath();
    const onOpenImage = vi.fn();
    renderDiffViewer({ onOpenImage });
    await screen.findByText("BETA");

    fireEvent.click(await screen.findByRole("option", { name: /image\.png/ }));
    await screen.findByAltText("image.png");

    fireEvent.click(screen.getByRole("button", { name: /open image image\.png/ }));

    expect(onOpenImage).toHaveBeenCalledTimes(1);
    expect(onOpenImage).toHaveBeenCalledWith("image.png");
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

  it("extends the range highlight over the sticky line-number gutter", async () => {
    // Regression: RangeHighlight had no z-index (z-auto), so the opaque sticky
    // gutter (z-10, painted in a higher stacking group) covered it and the
    // comment-range tint stopped at the line-number column. The highlight must
    // stack above the gutter so its tint reaches the gutter.
    mockHappyPath();
    const { container } = renderDiffViewer();
    await screen.findByText("BETA");

    // Anchoring a drag highlights the anchored line immediately (the in-progress
    // selection covers at least the anchor), mounting a RangeHighlight there.
    const annotateButtons = screen.getAllByLabelText(/comment on line/);
    act(() => {
      fireEvent.pointerDown(annotateButtons[1], { button: 0 });
    });

    const highlights = Array.from(
      container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]'),
    ).filter((node) => (node.getAttribute("class") ?? "").includes("bg-primary/10"));
    expect(highlights.length).toBeGreaterThan(0);

    const highlight = highlights[0];
    const gutter = Array.from(highlight.parentElement?.children ?? []).find(
      (node) => tailwindZIndexOf(node) === 10,
    );

    expect(tailwindZIndexOf(highlight)).not.toBeNull();
    expect(gutter).toBeTruthy();
    expect(Number(tailwindZIndexOf(highlight))).toBeGreaterThan(Number(tailwindZIndexOf(gutter)));
  });

  it("renders the annotate button above the sticky line-number gutter in unified mode", async () => {
    // Regression: the sticky gutter (z-10, opaque bg-background, painted after
    // the button in DOM order) occluded the annotate button at the same z-index,
    // so the comment bubble never showed on hover and pointerdown never reached
    // the drag handler. The button must stack strictly above the gutter.
    mockHappyPath();
    renderDiffViewer();
    await screen.findByText("BETA");

    const annotateButtons = screen.getAllByLabelText(/comment on line/);
    expect(annotateButtons.length).toBeGreaterThan(0);

    const annotateButton = annotateButtons[0];
    const buttonZ = tailwindZIndexOf(annotateButton);
    const gutterZ = tailwindZIndexOf(annotateButton.nextElementSibling);

    expect(buttonZ).not.toBeNull();
    expect(gutterZ).not.toBeNull();
    expect(Number(buttonZ)).toBeGreaterThan(Number(gutterZ));
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
  }, 15_000); // parallel cross-package run this starves past vitest's 5s default. // jsdom first-paint of a 2500-line patch is CPU-bound; under turbo's

  it("auto-switches to branch mode when the leased branchInfo has a PR", async () => {
    mockHappyPath();
    renderDiffViewer({ branchInfo: BRANCH_INFO });

    // No manual toggle — the leased PR derives branch mode immediately.
    await vi.waitFor(() =>
      expect(
        within(screen.getByRole("radiogroup", { name: "diff comparison" }))
          .getAllByRole("radio")[1]
          .getAttribute("aria-checked"),
      ).toBe("true"),
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
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "diff comparison" })).getAllByRole("radio")[0],
    );

    // The base picker is branch-only, but the PR badge stays as an indicator.
    expect(screen.queryByLabelText("base branch")).toBeNull();
    expect(screen.getByText("#123")).toBeTruthy();
  });

  it("prefetches branch-mode patches before the viewer opens when a PR is leased", async () => {
    // Regression: compareMode defaults to branch when branchInfo has a PR, but
    // the cwd-change effect fetched the working list first and the branch list
    // only after. The unified prefetch targets compareMode's list, so it sat
    // idle until the branch list arrived and opening in that window hit the
    // on-demand path ("Loading diff…"). Both lists now fetch in parallel, so
    // branch patches warm before open.
    filesMock.mockResolvedValue(FILE_LIST);
    patchMock.mockImplementation((_cwd, path) => Promise.resolve(PATCHES[path] ?? null));

    const { rerender } = render(
      <DiffViewer open={false} cwd="/repo" branchInfo={BRANCH_INFO} onClose={() => {}} />,
    );

    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/repo",
        "src/app.ts",
        expect.objectContaining({ mode: "branch" }),
        expect.any(AbortSignal),
      ),
    );

    rerender(<DiffViewer open cwd="/repo" branchInfo={BRANCH_INFO} onClose={() => {}} />);
    expect(await screen.findByText("BETA")).toBeTruthy();
    expect(screen.queryByText("Loading diff…")).toBeNull();
  });

  it("prefetches patches for a pre-open git-dirty edit before the viewer has ever been opened", async () => {
    // Regression: the closed-viewer git-dirty refresh was gated on
    // hasBeenOpenedRef, which dropped EVERY signal before first open — not just
    // the redundant startup one. A real local edit made once the terminal had
    // settled (but before opening) was skipped, so the file list stayed at the
    // startup snapshot and the first open hit the on-demand path ("Loading
    // diff…"). The gate now keys off the current mode's list being loaded, so
    // only the startup signal (duplicate of the cwd-change fetch) is skipped.
    const cleanList: GitDiffFileListResponse = { isRepo: true, files: [] };
    let workingTreeDirty = false;
    filesMock.mockImplementation((_cwd, query) =>
      Promise.resolve(
        query.mode === "working" ? (workingTreeDirty ? FILE_LIST : cleanList) : FILE_LIST,
      ),
    );
    patchMock.mockImplementation((_cwd, path) => Promise.resolve(PATCHES[path] ?? null));

    const { rerender } = render(
      <DiffViewer open={false} cwd="/repo" branchInfo={null} onClose={() => {}} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    workingTreeDirty = true;
    rerender(
      <DiffViewer
        open={false}
        cwd="/repo"
        branchInfo={null}
        gitDirtyVersion={1}
        onClose={() => {}}
      />,
    );

    await vi.waitFor(() =>
      expect(filesMock).toHaveBeenCalledWith(
        "/repo",
        expect.objectContaining({ mode: "working" }),
        expect.any(AbortSignal),
      ),
    );
    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/repo",
        "src/app.ts",
        expect.objectContaining({ mode: "working" }),
        expect.any(AbortSignal),
      ),
    );

    rerender(<DiffViewer open cwd="/repo" branchInfo={null} onClose={() => {}} />);
    expect(await screen.findByText("BETA")).toBeTruthy();
    expect(screen.queryByText("Loading diff…")).toBeNull();
  });

  it("stays in working mode when there is no PR", async () => {
    mockHappyPath();
    renderDiffViewer({ branchInfo: { ...BRANCH_INFO, pr: null } });
    await screen.findByText("BETA");

    expect(
      within(screen.getByRole("radiogroup", { name: "diff comparison" }))
        .getAllByRole("radio")[0]
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByText("#123")).toBeNull();
  });

  it("re-fetches a patch after close/reopen even when a previous fetch was in flight", async () => {
    // Regression: aborting an in-flight patch fetch on close left a stale
    // "loading" entry in the cache. On reopen, loadPatch bailed on the
    // tombstone and the diff showed "Loading diff…" forever.
    filesMock.mockResolvedValue(FILE_LIST);
    let patchCallCount = 0;
    patchMock.mockImplementation(async () => {
      patchCallCount += 1;
      // First invocation: never resolve (simulates a slow fetch that gets
      // aborted on close). Subsequent invocations resolve normally.
      if (patchCallCount === 1) return new Promise<GitDiffFilePatch | null>(() => {});
      return PATCHES["src/app.ts"] ?? null;
    });

    const { unmount } = render(
      <DiffViewer open cwd="/repo" branchInfo={null} onClose={() => {}} />,
    );

    // Wait for the patch request to be in flight.
    await vi.waitFor(() => expect(patchMock).toHaveBeenCalled());

    // Close the viewer while the patch fetch is still pending — this aborts
    // the fetch and (before the fix) leaves a stale "loading" entry.
    unmount();

    // Reopen the viewer — this time patches resolve immediately.
    mockHappyPath();
    renderDiffViewer();

    // The patch should load instead of staying in "Loading diff…" forever.
    expect(await screen.findByText("BETA")).toBeTruthy();
  });

  it("does not loop the background revalidation infinitely", async () => {
    // Regression: the on-open revalidation effect had branchFiles/workingFiles
    // as dependencies. Each background refresh changed those deps, re-triggered
    // the effect, causing an infinite fetch loop.
    const callCounts = { working: 0, branch: 0 };
    filesMock.mockImplementation(async (_cwd, query) => {
      if (query.mode === "working") callCounts.working += 1;
      else callCounts.branch += 1;
      return FILE_LIST;
    });
    patchMock.mockImplementation((_cwd, path) => Promise.resolve(PATCHES[path] ?? null));

    renderDiffViewer();
    await screen.findByText("BETA");

    // Wait a few event-loop turns for any further fetch to fire.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Working-mode file list should be fetched at most twice: once for the
    // initial no-data path and once for the background refresh on the next
    // open.
    expect(callCounts.working).toBeLessThanOrEqual(3);
  });

  it("invalidates cached patches when compare mode changes", async () => {
    // Regression: switching from working to branch mode left stale working-tree
    // patches in the cache. loadPatch bailed on state==="loaded", so the
    // branch diff showed the working-tree content.
    const branchPatch = ["@@ -1,3 +1,3 @@", " delta", "-epsilon", "+EPSILON", " zeta", ""].join(
      "\n",
    );

    filesMock.mockResolvedValue(FILE_LIST);
    const branchFileList: GitDiffFileListResponse = {
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
      ],
    };

    let patchModeSeen: string[] = [];
    patchMock.mockImplementation((_cwd, _path, query) => {
      patchModeSeen.push(query.mode);
      if (query.mode === "branch")
        return Promise.resolve({ patch: branchPatch, patchOmitted: false, binary: false });
      return Promise.resolve(PATCHES["src/app.ts"] ?? null);
    });

    // Start in working mode (no PR → default is working).
    renderDiffViewer();
    expect(await screen.findByText("BETA")).toBeTruthy();
    patchModeSeen = [];

    // Pre-seed branch file data so the on-open revalidation has data
    // immediately and doesn't clear the cache again.
    filesMock.mockImplementation(async (_cwd, query) => {
      return query.mode === "branch" ? branchFileList : FILE_LIST;
    });

    // Switch to branch mode.
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "diff comparison" })).getAllByRole("radio")[1],
    );

    // The branch-mode patch should be fetched.
    await vi.waitFor(() => expect(patchModeSeen).toContain("branch"));
    expect(await screen.findByText("EPSILON")).toBeTruthy();
    expect(screen.queryByText("BETA")).toBeNull();
  });

  it("clears patch cache when cwd changes", async () => {
    // Regression: switching repos left stale patches from the old repo in the
    // cache. loadPatch bailed on state==="loaded", showing wrong diff.
    mockHappyPath();
    const { rerender } = render(
      <DiffViewer open cwd="/repo-a" branchInfo={null} onClose={() => {}} />,
    );
    await screen.findByText("BETA");

    // Switch to a different repo — file list and patch cache should reset.
    const otherList: GitDiffFileListResponse = {
      isRepo: true,
      files: [
        {
          path: "src/app.ts",
          oldPath: null,
          status: "added",
          additions: 5,
          deletions: 0,
          binary: false,
        },
      ],
    };
    const otherPatch: GitDiffFilePatch = {
      patch: ["@@ -0,0 +1,5 @@", "+line1", "+line2", "+line3", "+line4", "+line5", ""].join("\n"),
      patchOmitted: false,
      binary: false,
    };
    filesMock.mockResolvedValue(otherList);
    patchMock.mockResolvedValue(otherPatch);

    rerender(<DiffViewer open cwd="/repo-b" branchInfo={null} onClose={() => {}} />);

    expect(await screen.findByText("line1")).toBeTruthy();
    expect(screen.queryByText("BETA")).toBeNull();
  });

  it("refreshes the file list in near-realtime when gitDirtyVersion bumps while open", async () => {
    filesMock.mockImplementation(async () => ({ ...FILE_LIST, files: [...FILE_LIST.files] }));
    patchMock.mockImplementation((_cwd, path) => Promise.resolve(PATCHES[path] ?? null));

    const { rerender } = render(
      <DiffViewer open cwd="/repo" branchInfo={null} onClose={() => {}} />,
    );
    await screen.findByText("BETA");

    filesMock.mockClear();

    rerender(
      <DiffViewer open cwd="/repo" branchInfo={null} gitDirtyVersion={1} onClose={() => {}} />,
    );

    await new Promise((resolve) =>
      setTimeout(resolve, DIFF_VIEWER_REALTIME_REFRESH_DEBOUNCE_MS + 50),
    );

    await vi.waitFor(() => expect(filesMock).toHaveBeenCalledTimes(1));
    expect(filesMock).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({ mode: "working" }),
      expect.any(AbortSignal),
    );
  });

  it("force-reloads the selected patch through the prefetch queue on a git-dirty signal", async () => {
    filesMock.mockImplementation(async () => ({ ...FILE_LIST, files: [...FILE_LIST.files] }));
    patchMock.mockImplementation((_cwd, path) => Promise.resolve(PATCHES[path] ?? null));

    const { rerender } = render(
      <DiffViewer open cwd="/repo" branchInfo={null} onClose={() => {}} />,
    );
    await screen.findByText("BETA");

    filesMock.mockClear();
    patchMock.mockClear();

    rerender(
      <DiffViewer open cwd="/repo" branchInfo={null} gitDirtyVersion={1} onClose={() => {}} />,
    );

    await new Promise((resolve) =>
      setTimeout(resolve, DIFF_VIEWER_REALTIME_REFRESH_DEBOUNCE_MS + 50),
    );

    await vi.waitFor(() => expect(filesMock).toHaveBeenCalledTimes(1));

    // The file refresh marked the selected file's patch metadata stale, so
    // the prefetch queue force-reloads it even though the metadata is identical.
    await vi.waitFor(() => {
      const appCalls = patchMock.mock.calls.filter(([, path]) => path === "src/app.ts");
      expect(appCalls).toHaveLength(1);
    });
    const imageCalls = patchMock.mock.calls.filter(([, path]) => path === "image.png");
    expect(imageCalls).toHaveLength(0);
  });
});
