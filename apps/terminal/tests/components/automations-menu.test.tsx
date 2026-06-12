import type { AutomationWithNextRun } from "@monotykamary/localterm-server/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AutomationsMenu } from "../../src/components/automations-menu";

const automation = (overrides: Partial<AutomationWithNextRun> = {}): AutomationWithNextRun => ({
  id: "automation-1",
  name: "nightly build",
  schedule: "0 2 * * *",
  cwd: "/tmp/project",
  command: "pnpm build",
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  lastRun: null,
  nextRunAt: Date.now() + 60_000,
  ...overrides,
});

interface HarnessProps {
  automations?: AutomationWithNextRun[] | null;
  onAutomationsLoaded?: (automations: AutomationWithNextRun[]) => void;
}

const renderAutomationsMenu = ({
  automations = [],
  onAutomationsLoaded = () => {},
}: HarnessProps = {}) =>
  render(
    <AutomationsMenu
      open
      onOpenChange={() => {}}
      automations={automations}
      onAutomationsLoaded={onAutomationsLoaded}
      defaultCwd="/tmp/project"
      isMac
    />,
  );

describe("AutomationsMenu", () => {
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
    renderAutomationsMenu({ automations: [] });
    expect(await screen.findByText(/no automations yet/i)).toBeDefined();
  });

  it("lists automations with schedule, command, and actions", async () => {
    renderAutomationsMenu({ automations: [automation()] });
    expect(await screen.findByText("nightly build")).toBeDefined();
    expect(screen.getByText("pnpm build")).toBeDefined();
    expect(screen.getByText("0 2 * * *")).toBeDefined();
    expect(screen.getByLabelText("run nightly build now")).toBeDefined();
    expect(screen.getByLabelText("edit nightly build")).toBeDefined();
    expect(screen.getByLabelText("delete nightly build")).toBeDefined();
    expect(screen.getByLabelText("toggle nightly build")).toBeDefined();
  });

  it("shows the last run status badge", async () => {
    renderAutomationsMenu({
      automations: [
        automation({
          lastRun: { runId: "run-1", at: Date.now(), status: "failed", exitCode: 2 },
        }),
      ],
    });
    expect(await screen.findByText("exit 2")).toBeDefined();
  });

  it("requires a second click to delete", async () => {
    renderAutomationsMenu({ automations: [automation()] });
    const deleteButton = await screen.findByLabelText("delete nightly build");
    fireEvent.click(deleteButton);
    expect(screen.getByLabelText("confirm delete nightly build")).toBeDefined();
    const fetchMock = vi.mocked(fetch);
    const deleteCalls = fetchMock.mock.calls.filter(
      (call) => call[1] && Reflect.get(call[1], "method") === "DELETE",
    );
    expect(deleteCalls).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("confirm delete nightly build"));
    await vi.waitFor(() => {
      const confirmedCalls = fetchMock.mock.calls.filter(
        (call) => call[1] && Reflect.get(call[1], "method") === "DELETE",
      );
      expect(confirmedCalls).toHaveLength(1);
    });
  });

  it("opens the create form and validates the cron schedule", async () => {
    renderAutomationsMenu({ automations: [] });
    fireEvent.click(await screen.findByLabelText("new automation"));
    const scheduleInput = screen.getByLabelText("automation schedule");
    fireEvent.change(scheduleInput, { target: { value: "not a cron" } });
    expect(screen.getByText("invalid cron expression")).toBeDefined();
    fireEvent.change(scheduleInput, { target: { value: "*/5 * * * *" } });
    expect(screen.getByText(/next run in/i)).toBeDefined();
  });

  it("prefills the directory with the live cwd when creating", async () => {
    renderAutomationsMenu({ automations: [] });
    fireEvent.click(await screen.findByLabelText("new automation"));
    const cwdInput = screen.getByLabelText("automation directory");
    expect(cwdInput.getAttribute("value") ?? Reflect.get(cwdInput, "value")).toBe("/tmp/project");
  });

  it("disables create until the form is valid", async () => {
    renderAutomationsMenu({ automations: [] });
    fireEvent.click(await screen.findByLabelText("new automation"));
    const createButton = screen.getByRole("button", { name: "Create" });
    expect(createButton.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("automation name"), { target: { value: "demo" } });
    fireEvent.change(screen.getByLabelText("automation command"), {
      target: { value: "echo hi" },
    });
    fireEvent.change(screen.getByLabelText("automation schedule"), {
      target: { value: "@daily" },
    });
    expect(createButton.hasAttribute("disabled")).toBe(false);
  });

  it("submits a new automation", async () => {
    const fetchMock = vi.mocked(fetch);
    renderAutomationsMenu({ automations: [] });
    fireEvent.click(await screen.findByLabelText("new automation"));
    fireEvent.change(screen.getByLabelText("automation name"), { target: { value: "demo" } });
    fireEvent.change(screen.getByLabelText("automation command"), {
      target: { value: "echo hi" },
    });
    fireEvent.change(screen.getByLabelText("automation schedule"), {
      target: { value: "@daily" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (call) => call[1] && Reflect.get(call[1], "method") === "POST",
      );
      expect(postCalls).toHaveLength(1);
      const requestBody = JSON.parse(String(Reflect.get(postCalls[0][1] ?? {}, "body")));
      expect(requestBody).toEqual({
        name: "demo",
        schedule: "@daily",
        cwd: "/tmp/project",
        command: "echo hi",
        enabled: true,
      });
    });
  });
});
