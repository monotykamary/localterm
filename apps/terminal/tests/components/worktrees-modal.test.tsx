import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  GitWorktreeListResponse,
  WorktreeIncludeFile,
  WorktreeRepoConfig,
} from "@monotykamary/localterm-server/protocol";
import { WorktreesModal } from "../../src/components/worktrees-modal";
import { WORKTREES_LIST_ROW_HEIGHT_PX } from "../../src/lib/constants";

interface FakeVirtualizerOptions {
  count: number;
}

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: FakeVirtualizerOptions) => ({
    getTotalSize: () => count,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index,
      })),
    measureElement: () => {},
  }),
}));

const mocks = vi.hoisted(() => ({
  fetchGitWorktrees: vi.fn(),
  fetchWorktreeConfig: vi.fn(),
  fetchWorktreeIncludeFile: vi.fn(),
  launchCommand: vi.fn(),
  removeGitWorktree: vi.fn(),
  sweepWorktrees: vi.fn(),
  updateWorktreeConfig: vi.fn(),
  updateWorktreeIncludeFile: vi.fn(),
}));

vi.mock("../../src/utils/fetch-git-worktrees", () => mocks);

const worktrees: GitWorktreeListResponse = {
  isRepo: true,
  displayBaseDir: "~/.localterm/worktrees/localterm",
  worktrees: [
    {
      path: "/Users/tester/.localterm/worktrees/localterm/feature-visible",
      displayPath: "~/.localterm/worktrees/localterm/feature-visible",
      branch: "feature/visible",
      head: "0123456789abcdef",
      isCurrent: false,
      isMain: false,
      isLocked: false,
      isPrunable: false,
      activeSessionCount: 0,
    },
  ],
};

const config: WorktreeRepoConfig = {
  setupScript: "",
  openInCommands: [],
  baseRef: "fresh",
};

const includeFile: WorktreeIncludeFile = {
  exists: false,
  content: "",
  path: ".worktreeinclude",
};

describe("WorktreesModal", () => {
  beforeEach(() => {
    mocks.fetchGitWorktrees.mockReset();
    mocks.fetchWorktreeConfig.mockReset();
    mocks.fetchWorktreeIncludeFile.mockReset();
    mocks.fetchGitWorktrees.mockResolvedValue(worktrees);
    mocks.fetchWorktreeConfig.mockResolvedValue(config);
    mocks.fetchWorktreeIncludeFile.mockResolvedValue(includeFile);
  });

  it("keeps each worktree path and revision visible without hover", async () => {
    render(
      <WorktreesModal
        open
        cwd="/Users/tester/Developer/localterm"
        isMac
        createError={null}
        onCreate={vi.fn()}
        onDismissCreateError={vi.fn()}
        onClose={vi.fn()}
        onOpenShell={vi.fn()}
      />,
    );

    const branch = await screen.findByText("feature/visible");
    const path = screen.getByText("~/.localterm/worktrees/localterm/feature-visible");
    const revision = screen.getByText("0123456");
    const row = branch.closest<HTMLElement>("[role='listitem']");

    expect(branch.className).toContain("text-foreground");
    expect(row?.style.minHeight).toBe(`${WORKTREES_LIST_ROW_HEIGHT_PX}px`);
    expect(path.parentElement?.className).not.toContain("opacity-0");
    expect(revision.parentElement).toBe(path.parentElement);
  });
});
