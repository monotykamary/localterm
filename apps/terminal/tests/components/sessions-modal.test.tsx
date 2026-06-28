import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionsModal } from "../../src/components/sessions-modal";
import type { SessionListItem } from "@monotykamary/localterm-server/protocol";

const mocks = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  killSession: vi.fn(),
}));

vi.mock("../../src/utils/fetch-sessions", () => ({
  fetchSessions: mocks.fetchSessions,
  killSession: mocks.killSession,
}));

// jsdom doesn't lay out, so the real virtualizer's scroll element has zero
// height and renders zero rows. Render every item instead so option roles are
// queryable — the same stub the diff-viewer test uses.
vi.mock("@tanstack/react-virtual", () => {
  const SESSION_ROW_HEIGHT = 36;
  return {
    useVirtualizer: ({
      count,
      getItemKey,
      estimateSize,
    }: {
      count: number;
      getItemKey: (index: number) => string;
      estimateSize: () => number;
    }) => {
      const rowHeight = estimateSize ? estimateSize() : SESSION_ROW_HEIGHT;
      return {
        getTotalSize: () => count * rowHeight,
        getVirtualItems: () =>
          Array.from({ length: count }, (_, i) => ({
            index: i,
            start: i * rowHeight,
            size: rowHeight,
            key: getItemKey(i),
          })),
        scrollToIndex: () => {},
        measureElement: () => {},
      };
    },
  };
});

const buildSession = (overrides: Partial<SessionListItem> = {}): SessionListItem => ({
  id: "00000000-0000-0000-0000-000000000001",
  pid: 4242,
  shell: "/bin/zsh",
  shellName: "zsh",
  cwd: "/home/me/my-app",
  title: "my-app",
  createdAt: Date.now(),
  lastOutputAt: Date.now(),
  clients: 1,
  state: "running",
  ...overrides,
});

const buildRefs = () => ({
  liveSessionIdRef: { current: null as string | null },
  previousSessionIdRef: { current: null as string | null },
  switchSessionRef: { current: null as ((sid: string) => void) | null },
});

afterEach(cleanup);

describe("SessionsModal", () => {
  beforeEach(() => {
    mocks.fetchSessions.mockReset();
    mocks.killSession.mockReset();
    mocks.killSession.mockResolvedValue(true);
  });

  it("lists the daemon's live sessions", async () => {
    mocks.fetchSessions.mockResolvedValue([
      buildSession({ id: "a".repeat(8) + "-0000-0000-0000-000000000001", title: "my-app" }),
      buildSession({ id: "b".repeat(8) + "-0000-0000-0000-000000000002", title: "api", pid: 4243 }),
    ]);
    const refs = buildRefs();
    render(
      <SessionsModal
        open
        liveSessionIdRef={refs.liveSessionIdRef}
        previousSessionIdRef={refs.previousSessionIdRef}
        switchSessionRef={refs.switchSessionRef}
        isTouchDevice={false}
        onOpenNewShell={() => {}}
        onClose={() => {}}
      />,
    );

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("my-app");
    expect(options[1].textContent).toContain("api");
  });

  it("filters sessions by the search query", async () => {
    mocks.fetchSessions.mockResolvedValue([
      buildSession({ id: "a".repeat(8) + "-0000-0000-0000-000000000001", title: "my-app" }),
      buildSession({ id: "b".repeat(8) + "-0000-0000-0000-000000000002", title: "api" }),
    ]);
    const refs = buildRefs();
    render(
      <SessionsModal
        open
        liveSessionIdRef={refs.liveSessionIdRef}
        previousSessionIdRef={refs.previousSessionIdRef}
        switchSessionRef={refs.switchSessionRef}
        isTouchDevice={false}
        onOpenNewShell={() => {}}
        onClose={() => {}}
      />,
    );

    await screen.findAllByRole("option");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "api" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("api");
  });

  it("shows an empty state when no sessions are live", async () => {
    mocks.fetchSessions.mockResolvedValue([]);
    const refs = buildRefs();
    render(
      <SessionsModal
        open
        liveSessionIdRef={refs.liveSessionIdRef}
        previousSessionIdRef={refs.previousSessionIdRef}
        switchSessionRef={refs.switchSessionRef}
        isTouchDevice={false}
        onOpenNewShell={() => {}}
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText(/no live shells/i)).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("shows a header spinner (not a body spinner) while the fetch is pending", async () => {
    let resolveFetch: (value: SessionListItem[]) => void = () => {};
    mocks.fetchSessions.mockImplementation(
      () =>
        new Promise<SessionListItem[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const refs = buildRefs();
    render(
      <SessionsModal
        open
        liveSessionIdRef={refs.liveSessionIdRef}
        previousSessionIdRef={refs.previousSessionIdRef}
        switchSessionRef={refs.switchSessionRef}
        isTouchDevice={false}
        onOpenNewShell={() => {}}
        onClose={() => {}}
      />,
    );

    // The small loading spinner lives in the header while the fetch is pending;
    // the body stays empty (no options, no centered spinner that then swaps for
    // the list — the flash the worktrees/ports modals avoid the same way).
    expect(await screen.findByRole("status", { name: "loading sessions" })).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    resolveFetch([buildSession()]);
    await screen.findAllByRole("option");
  });

  it("kills a session when its kill button is clicked and refetches", async () => {
    const id = "a".repeat(8) + "-0000-0000-0000-000000000001";
    mocks.fetchSessions.mockResolvedValue([buildSession({ id, title: "my-app" })]);
    const refs = buildRefs();
    render(
      <SessionsModal
        open
        liveSessionIdRef={refs.liveSessionIdRef}
        previousSessionIdRef={refs.previousSessionIdRef}
        switchSessionRef={refs.switchSessionRef}
        isTouchDevice={false}
        onOpenNewShell={() => {}}
        onClose={() => {}}
      />,
    );

    await screen.findAllByRole("option");
    fireEvent.click(screen.getByRole("button", { name: /kill my-app/i }));

    await waitFor(() => expect(mocks.killSession).toHaveBeenCalledWith(id));
    await waitFor(() => expect(mocks.fetchSessions).toHaveBeenCalledTimes(2));
  });

  it("hides the keyboard hints on a touch device", async () => {
    mocks.fetchSessions.mockResolvedValue([buildSession()]);
    const refs = buildRefs();
    render(
      <SessionsModal
        open
        liveSessionIdRef={refs.liveSessionIdRef}
        previousSessionIdRef={refs.previousSessionIdRef}
        switchSessionRef={refs.switchSessionRef}
        isTouchDevice
        onOpenNewShell={() => {}}
        onClose={() => {}}
      />,
    );

    await screen.findAllByRole("option");
    expect(screen.queryByText("navigate")).toBeNull();
    expect(screen.queryByText("switch")).toBeNull();
  });

  it("closes on Escape", async () => {
    mocks.fetchSessions.mockResolvedValue([buildSession()]);
    const onClose = vi.fn();
    const refs = buildRefs();
    render(
      <SessionsModal
        open
        liveSessionIdRef={refs.liveSessionIdRef}
        previousSessionIdRef={refs.previousSessionIdRef}
        switchSessionRef={refs.switchSessionRef}
        isTouchDevice={false}
        onOpenNewShell={() => {}}
        onClose={onClose}
      />,
    );

    await screen.findAllByRole("option");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
