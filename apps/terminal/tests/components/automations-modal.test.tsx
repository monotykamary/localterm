import type { AutomationWithNextRun } from "@monotykamary/localterm-server/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AutomationsModal } from "../../src/components/automations-modal";

vi.mock("@tanstack/react-virtual", () => {
  const ROW_HEIGHT = 32;
  return {
    useVirtualizer: ({
      count,
      getItemKey,
    }: {
      count: number;
      getItemKey: (index: number) => string;
    }) => ({
      getTotalSize: () => count * ROW_HEIGHT,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, i) => ({
          index: i,
          start: i * ROW_HEIGHT,
          size: ROW_HEIGHT,
          key: getItemKey(i),
        })),
      scrollToIndex: () => {},
      measure: () => {},
    }),
  };
});

// Base UI's Select (used by the schedule builder) observes its trigger size.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const PI_HARNESS = { kind: "pi", extensions: true, skills: true, contextFiles: true } as const;

const automation = (overrides: Partial<AutomationWithNextRun> = {}): AutomationWithNextRun => ({
  id: "automation-1",
  name: "nightly build",
  trigger: { kind: "schedule", schedule: { kind: "daily", hour: 2, minute: 0 } },
  cron: "0 2 * * *",
  cwd: "/tmp/project",
  runner: { kind: "shell", command: "pnpm build" },
  enabled: true,
  limit: { kind: "forever" },
  closeOnFinish: false,
  requestedSecrets: [],
  runCount: 0,
  lifecycle: "active",
  runs: [],
  createdAt: 0,
  updatedAt: 0,
  nextRunAt: Date.now() + 60_000,
  lastRun: null,
  ...overrides,
});

const renderModal = (automations: AutomationWithNextRun[] | null = []) =>
  render(
    <AutomationsModal
      open
      onClose={() => {}}
      automations={automations}
      onAutomationsLoaded={() => {}}
      defaultCwd="/tmp/project"
      isMac
    />,
  );

describe("AutomationsModal", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/health")) {
          // CDP connected so the Close-on-finish toggle is editable; the guard
          // locks it off when no debug-enabled browser is reachable.
          return new Response(
            JSON.stringify({
              ok: true,
              sessions: 0,
              cdp: { connected: true, browser: "Chrome" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ automations: [] }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the empty state", async () => {
    renderModal([]);
    expect(await screen.findByText(/Create one to get started/)).toBeDefined();
  });

  it("lists an automation with a friendly schedule label and shows its detail", async () => {
    renderModal([automation()]);
    // The name appears in the list row and the detail header.
    expect((await screen.findAllByText("nightly build")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Daily at 2:00 AM").length).toBeGreaterThan(0);
    expect(screen.getByText("Shell: pnpm build")).toBeDefined();
  });

  it("clears a single automation's run history via the per-automation eraser button", async () => {
    const run = {
      runId: "run-1",
      scheduledFor: 1000,
      startedAt: 1000,
      finishedAt: 2000,
      status: "completed" as const,
      exitCode: 0,
      trigger: "schedule" as const,
      countsTowardLimit: true,
      findings: null,
      changedFiles: [],
      unread: false,
      log: null,
    };
    renderModal([automation({ runs: [run] })]);
    const clearButton = await screen.findByLabelText("clear nightly build run history");
    // First click arms (two-click confirm, like delete); no request yet.
    fireEvent.click(clearButton);
    expect(screen.getByLabelText("confirm clear nightly build run history")).toBeDefined();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/api/automations/automation-1/clear-history"),
      ),
    ).toBe(false);
    // Second click fires the per-automation clear (not the /triage all-clear).
    fireEvent.click(screen.getByLabelText("confirm clear nightly build run history"));
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/api/automations/automation-1/clear-history"),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/triage/clear-history")),
    ).toBe(false);
  });

  it("clears a thread agent's session via the clear-thread button (two-click confirm)", async () => {
    renderModal([
      automation({
        name: "reviewer",
        runner: {
          kind: "agent",
          prompt: "review commits",
          sessionMode: "thread",
          harness: PI_HARNESS,
        },
      }),
    ]);
    const clearButton = await screen.findByLabelText("clear reviewer thread");
    // First click arms (two-click confirm, like delete); no request yet.
    fireEvent.click(clearButton);
    expect(screen.getByLabelText("confirm clear reviewer thread")).toBeDefined();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/api/automations/automation-1/clear-thread"),
      ),
    ).toBe(false);
    // Second click fires the clear-thread POST.
    fireEvent.click(screen.getByLabelText("confirm clear reviewer thread"));
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/api/automations/automation-1/clear-thread"),
      ),
    ).toBe(true);
  });

  it("does not show the clear-thread button for a fresh agent automation", async () => {
    renderModal([
      automation({
        name: "fresh run",
        runner: { kind: "agent", prompt: "do a thing", sessionMode: "fresh", harness: PI_HARNESS },
      }),
    ]);
    await screen.findAllByText("fresh run");
    expect(screen.queryByLabelText("clear fresh run thread")).toBeNull();
  });

  it("renders a watch automation with its trigger label and on-change next run", async () => {
    renderModal([
      automation({
        name: "on change",
        trigger: { kind: "watch", recursive: true },
        cron: null,
        nextRunAt: null,
      }),
    ]);
    // The trigger label shows in both the list row and the detail header.
    expect((await screen.findAllByText("When files change · subfolders")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("On change")).toBeDefined();
  });

  it("renders a watch automation with a filter in its trigger label", async () => {
    renderModal([
      automation({
        name: "autoconvert",
        trigger: { kind: "watch", recursive: false, filter: "*.mov" },
        cron: null,
        nextRunAt: null,
      }),
    ]);
    expect((await screen.findAllByText("When files change matching *.mov")).length).toBeGreaterThan(
      0,
    );
  });

  it("shows the last run status badge", async () => {
    renderModal([
      automation({ lastRun: { runId: "r", at: Date.now(), status: "failed", exitCode: 2 } }),
    ]);
    expect((await screen.findAllByText("exit 2")).length).toBeGreaterThan(0);
  });

  it("requires a second click to delete", async () => {
    renderModal([automation()]);
    const deleteButton = await screen.findByLabelText("delete nightly build");
    fireEvent.click(deleteButton);
    expect(screen.getByLabelText("confirm delete nightly build")).toBeDefined();
    const fetchMock = vi.mocked(fetch);
    const deleteCalls = () =>
      fetchMock.mock.calls.filter((call) => call[1] && Reflect.get(call[1], "method") === "DELETE");
    expect(deleteCalls()).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("confirm delete nightly build"));
    await vi.waitFor(() => expect(deleteCalls()).toHaveLength(1));
  });

  it("opens the create form prefilled with the live cwd and validates", async () => {
    renderModal([]);
    fireEvent.click(await screen.findByLabelText("new automation"));
    const cwdInput = screen.getByLabelText("automation directory");
    expect(cwdInput.getAttribute("value") ?? Reflect.get(cwdInput, "value")).toBe("/tmp/project");
    const createButton = screen.getByRole("button", { name: "Create" });
    expect(createButton.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("automation name"), { target: { value: "demo" } });
    fireEvent.change(screen.getByLabelText("automation command"), { target: { value: "echo hi" } });
    expect(createButton.hasAttribute("disabled")).toBe(false);
  });

  it("submits a new automation with a structured schedule and limit", async () => {
    const fetchMock = vi.mocked(fetch);
    renderModal([]);
    fireEvent.click(await screen.findByLabelText("new automation"));
    fireEvent.change(screen.getByLabelText("automation name"), { target: { value: "demo" } });
    fireEvent.change(screen.getByLabelText("automation command"), { target: { value: "echo hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (call) => call[1] && Reflect.get(call[1], "method") === "POST",
      );
      expect(postCalls).toHaveLength(1);
      const body = JSON.parse(String(Reflect.get(postCalls[0][1] ?? {}, "body")));
      expect(body).toEqual({
        name: "demo",
        trigger: { kind: "schedule", schedule: { kind: "daily", hour: 9, minute: 0 } },
        cwd: "/tmp/project",
        runner: { kind: "shell", command: "echo hi" },
        enabled: true,
        limit: { kind: "forever" },
        closeOnFinish: false,
        requestedSecrets: [],
      });
    });
  });

  it("submits closeOnFinish when the toggle is enabled", async () => {
    const fetchMock = vi.mocked(fetch);
    renderModal([]);
    fireEvent.click(await screen.findByLabelText("new automation"));
    fireEvent.change(screen.getByLabelText("automation name"), { target: { value: "demo" } });
    fireEvent.change(screen.getByLabelText("automation command"), { target: { value: "echo hi" } });
    fireEvent.click(screen.getByLabelText("close tab when finished"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (call) => call[1] && Reflect.get(call[1], "method") === "POST",
      );
      expect(postCalls).toHaveLength(1);
      const body = JSON.parse(String(Reflect.get(postCalls[0][1] ?? {}, "body")));
      expect(body.closeOnFinish).toBe(true);
    });
  });

  it("warns close-on-finish needs remote debugging when no browser is connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/health")) {
          return new Response(
            JSON.stringify({ ok: true, sessions: 0, cdp: { connected: false } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ automations: [] }), { status: 200 });
      }),
    );
    renderModal([]);
    fireEvent.click(await screen.findByLabelText("new automation"));
    expect(await screen.findByText(/won't close until it's on/)).toBeDefined();
  });
});

const threadAutomation = (): AutomationWithNextRun =>
  automation({
    runner: {
      kind: "agent",
      sessionMode: "thread",
      prompt: "review the latest commit",
      harness: { kind: "pi", extensions: true, skills: true, contextFiles: true },
    },
    runs: [
      {
        runId: "run-1",
        scheduledFor: Date.now(),
        startedAt: Date.now(),
        finishedAt: Date.now(),
        status: "completed",
        exitCode: 0,
        trigger: "manual",
        countsTowardLimit: false,
        findings: "Summary of work.",
        changedFiles: [],
        unread: false,
        log: [{ type: "assistant", text: "hello" }],
      },
    ],
  });

describe("AutomationsModal run log", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/health")) {
          return new Response(
            JSON.stringify({ ok: true, sessions: 0, cdp: { connected: true, browser: "Chrome" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/session")) {
          return new Response(
            JSON.stringify({ entries: [{ type: "assistant", text: "transcript body" }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ automations: [] }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens at the top and surfaces a scroll-to-bottom button only when scrolled away from the bottom", async () => {
    renderModal([threadAutomation()]);
    fireEvent.click((await screen.findByText("Summary of work.")).closest("button")!);
    const transcript = await screen.findByText("transcript body");
    const scrollContainer = transcript.closest<HTMLElement>(".overflow-auto")!;

    // jsdom reports no overflow, so the log reads as already pinned to the
    // bottom and the scroll-to-bottom button stays hidden (aria-hidden).
    expect(screen.queryByRole("button", { name: "scroll to bottom" })).toBeNull();

    // Pretend the transcript is taller than the viewport and scrolled up.
    Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 200, configurable: true });
    fireEvent.scroll(scrollContainer);
    const scrollButton = await screen.findByRole("button", { name: "scroll to bottom" });
    expect(scrollButton).toBeDefined();

    // Clicking pins to the bottom and hides the button once the scroll settles.
    fireEvent.click(scrollButton);
    expect(scrollContainer.scrollTop).toBe(1000);
    fireEvent.scroll(scrollContainer);
    expect(screen.queryByRole("button", { name: "scroll to bottom" })).toBeNull();
  });
});
