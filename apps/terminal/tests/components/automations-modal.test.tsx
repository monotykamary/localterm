import type { AutomationWithNextRun } from "@monotykamary/localterm-server/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AutomationsModal } from "../../src/components/automations-modal";

// Base UI's Select (used by the schedule builder) observes its trigger size.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const automation = (overrides: Partial<AutomationWithNextRun> = {}): AutomationWithNextRun => ({
  id: "automation-1",
  name: "nightly build",
  trigger: { kind: "schedule", schedule: { kind: "daily", hour: 2, minute: 0 } },
  cron: "0 2 * * *",
  cwd: "/tmp/project",
  command: "pnpm build",
  enabled: true,
  limit: { kind: "forever" },
  closeOnFinish: false,
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
      vi.fn(async () => new Response(JSON.stringify({ automations: [] }), { status: 200 })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the empty state", async () => {
    renderModal([]);
    expect(await screen.findByText(/no automations yet/i)).toBeDefined();
  });

  it("lists an automation with a friendly schedule label and shows its detail", async () => {
    renderModal([automation()]);
    // The name appears in the list row and the detail header.
    expect((await screen.findAllByText("nightly build")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Daily at 2:00 AM").length).toBeGreaterThan(0);
    expect(screen.getByText("pnpm build")).toBeDefined();
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
    expect((await screen.findAllByText("When files change · subfolders")).length).toBeGreaterThan(0);
    expect(screen.getByText("On change")).toBeDefined();
  });

  it("shows the last run status badge", async () => {
    renderModal([
      automation({ lastRun: { runId: "r", at: Date.now(), status: "failed", exitCode: 2 } }),
    ]);
    expect(await screen.findByText("exit 2")).toBeDefined();
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
        command: "echo hi",
        enabled: true,
        limit: { kind: "forever" },
        closeOnFinish: false,
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
});
