import type {
  AutomationRunWireRecord,
  AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AutomationsModal } from "../../src/components/automations-modal";
import {
  AutomationListPopover,
  AutomationSidebar,
} from "../../src/components/automation-navigation";

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

// Served by the stubbed on-demand log endpoint for the agent-run test below —
// the wire list carries only hasLog, so the log view fetches the transcript.
const agentRunTranscript = [
  { type: "user", text: "user request" },
  {
    type: "assistant",
    text: "**assistant response**",
    thinking: "**assistant thinking**",
  },
  { type: "tool", name: "read", input: "src/app.ts", text: "tool output" },
];

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
  redactOutput: false,
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

const LiveAutomationModal = ({ initial }: { initial: AutomationWithNextRun }) => {
  const [items, setItems] = useState([initial]);
  return (
    <AutomationsModal
      open
      onClose={() => {}}
      automations={items}
      onAutomationsLoaded={setItems}
      defaultCwd="/tmp/project"
      isMac
    />
  );
};

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
        if (url.includes("/runs/agent-run/log")) {
          return new Response(JSON.stringify({ log: agentRunTranscript }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ automations: [] }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("navigates from Upcoming to the detail and supports arrow-key tabs", async () => {
    renderModal([automation({ timezone: "UTC" })]);
    const tab = await screen.findByRole("tab", { name: "Automations" });
    fireEvent.keyDown(tab, { key: "End" });
    expect(screen.getByRole("tab", { name: "Upcoming" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.click(screen.getAllByRole("button", { name: /open nightly build scheduled/ })[0]);
    expect(screen.getByRole("tab", { name: "Automations" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("Shell: pnpm build")).toBeDefined();
  });

  it.each(["queued", "skipped"])(
    "reports a %s run-now response instead of claiming a launch",
    async (status) => {
      const original = vi.mocked(fetch).getMockImplementation()!;
      vi.mocked(fetch).mockImplementation(async (input, init) =>
        String(input).endsWith("/run")
          ? new Response(JSON.stringify({ runId: "manual-1", status }))
          : original(input, init),
      );
      renderModal([automation()]);
      fireEvent.click(await screen.findByRole("button", { name: "run nightly build now" }));
      expect(
        await screen.findByText(
          status === "queued" ? /Run queued — waiting/ : /Run skipped — nothing new launched/,
        ),
      ).toBeDefined();
    },
  );

  it("sends queued cancellation and explains the no-longer-queued race", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(input).endsWith("/cancel")
        ? new Response("{}", { status: 409 })
        : original(input, init),
    );
    const run: AutomationRunWireRecord = {
      runId: "waiting",
      scheduledFor: 1000,
      startedAt: null,
      finishedAt: null,
      status: "queued",
      exitCode: null,
      trigger: "manual",
      countsTowardLimit: false,
      findings: null,
      changedFiles: [],
      unread: false,
      hasLog: false,
    };
    renderModal([automation({ runs: [run] })]);
    fireEvent.click(await screen.findByRole("button", { name: "cancel queued run waiting" }));
    expect(await screen.findByText(/no longer queued; it may have started/)).toBeDefined();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some((call) => String(call[0]).endsWith("/automation-1/runs/waiting/cancel")),
    ).toBe(true);
  });

  it("round-trips an anchored interval and saved zone while serializing an old thread allow policy", async () => {
    const schedule = {
      kind: "interval",
      every: 17,
      unit: "minutes",
      anchorAt: 1712345678123,
    } as const;
    renderModal([
      automation({
        timezone: "Pacific/Chatham",
        concurrencyPolicy: "allow",
        missedRunPolicy: "run-latest",
        trigger: { kind: "schedule", schedule },
        runner: { kind: "agent", prompt: "review", sessionMode: "thread", harness: PI_HARNESS },
      }),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "edit nightly build" }));
    expect((screen.getByLabelText("Schedule time zone") as HTMLInputElement).value).toBe(
      "Pacific/Chatham",
    );
    expect(
      (screen.getByRole("radio", { name: /Run alongside it/ }) as HTMLInputElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const patch = vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(patch).toBeDefined();
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      timezone: "Pacific/Chatham",
      concurrencyPolicy: "queue-latest",
      missedRunPolicy: "run-latest",
      trigger: { kind: "schedule", schedule },
    });
  });

  it("applies cancelled queued work returned when pausing, even if the following refresh fails", async () => {
    const queued: AutomationRunWireRecord = {
      runId: "waiting",
      scheduledFor: 1000,
      startedAt: null,
      finishedAt: null,
      status: "queued",
      exitCode: null,
      trigger: "manual",
      countsTowardLimit: false,
      findings: null,
      changedFiles: [],
      unread: false,
      hasLog: false,
    };
    const initial = automation({ runs: [queued] });
    const paused = automation({
      enabled: false,
      runs: [{ ...queued, status: "cancelled", reason: "disabled", finishedAt: 2000 }],
    });
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === "PATCH") return new Response(JSON.stringify({ automation: paused }));
      if (String(input).endsWith("/api/automations"))
        return new Response("unavailable", { status: 503 });
      return original(input, init);
    });
    render(<LiveAutomationModal initial={initial} />);
    fireEvent.click(await screen.findByRole("switch", { name: "toggle nightly build" }));
    expect(
      await screen.findByText(
        /Automation paused. Future triggers are off and queued work was cancelled/,
      ),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "cancel queued run waiting" })).toBeNull();
    expect(screen.getByText("cancelled")).toBeDefined();
    expect(
      screen.getByRole("switch", { name: "toggle nightly build" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("distinguishes no future occurrence from paused in both navigation variants", () => {
    const navigation = (enabled: boolean) => (
      <>
        <AutomationSidebar
          automations={[automation({ enabled, nextRunAt: null })]}
          sortBy="last-run"
          search=""
          selectedId={null}
          nowMs={0}
          onSortChange={() => {}}
          onSearchChange={() => {}}
          onSelect={() => {}}
        />
        <AutomationListPopover
          automations={[automation({ enabled, nextRunAt: null })]}
          selectedId={null}
          nowMs={0}
          onSelect={() => {}}
        />
      </>
    );
    const { rerender } = render(navigation(true));
    expect(screen.getAllByText("No next occurrence")).toHaveLength(2);
    expect(screen.queryByText("paused")).toBeNull();
    rerender(navigation(false));
    expect(screen.getAllByText("paused")).toHaveLength(2);
    expect(screen.queryByText("No next occurrence")).toBeNull();
  });

  it("keeps full tab labels on a second row at mobile modal widths", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(350);
    try {
      renderModal([]);
      const upcoming = await screen.findByRole("tab", { name: "Upcoming" });
      expect(upcoming.textContent).toBe("Upcoming");
      expect(screen.getByRole("tab", { name: "Automations" }).textContent).toBe("Automations");
      expect(screen.getByRole("tab", { name: "Triage" }).textContent).toBe("Triage");
      expect(screen.getByRole("tablist").className).toContain("order-last basis-full");
      expect(screen.getByRole("heading", { name: "Automations" })).toBeDefined();
      expect(screen.getByRole("button", { name: "close automations" })).toBeDefined();
    } finally {
      width.mockRestore();
    }
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
      hasLog: false,
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

  it("uses theme-aware colors for agent transcript entries", async () => {
    const run: AutomationRunWireRecord = {
      runId: "agent-run",
      scheduledFor: 1000,
      startedAt: 1000,
      finishedAt: 2000,
      status: "completed",
      exitCode: 0,
      trigger: "manual",
      countsTowardLimit: true,
      findings: "review findings",
      changedFiles: [],
      unread: false,
      hasLog: true,
    };
    renderModal([
      automation({
        runner: {
          kind: "agent",
          prompt: "review",
          sessionMode: "fresh",
          harness: PI_HARNESS,
        },
        runs: [run],
      }),
    ]);

    const preview = await screen.findByText("review findings");
    const runButton = preview.closest<HTMLButtonElement>("button");
    if (!runButton) throw new Error("run row was not rendered as a button");
    fireEvent.click(runButton);

    expect((await screen.findByText("user request")).className).toContain("text-foreground/90");
    expect(screen.getByText("assistant response").className).toContain("text-foreground");
    const thinking = screen.getByText("assistant thinking");
    expect(thinking.tagName).toBe("STRONG");
    expect(thinking.closest(".text-muted-foreground")).not.toBeNull();
    expect(screen.getByText("read").className).toContain("text-[var(--localterm-green)]");
    expect(screen.getByText("tool output").className).toContain("text-foreground/80");
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
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        concurrencyPolicy: "skip",
        missedRunPolicy: "skip",
        name: "demo",
        trigger: { kind: "schedule", schedule: { kind: "daily", hour: 9, minute: 0 } },
        cwd: "/tmp/project",
        runner: { kind: "shell", command: "echo hi" },
        enabled: true,
        limit: { kind: "forever" },
        closeOnFinish: false,
        requestedSecrets: [],
        redactOutput: false,
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
        hasLog: true,
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
