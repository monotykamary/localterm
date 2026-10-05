import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AutomationAgenda } from "../../src/components/automation-agenda";
import { AutomationSchedulePreview } from "../../src/components/automation-schedule-preview";
import { AutomationSafetyFields } from "../../src/components/automation-safety-fields";
import { AutomationDetail } from "../../src/components/automation-detail";
import { defaultScheduleForm } from "../../src/utils/schedule-builder";
import { defaultRunnerForm } from "../../src/utils/runner-form";
import { automationFixture, runFixture } from "../fixtures/automation";
import type { AutomationFormState } from "../../src/lib/automation-form-state";

const now = Date.UTC(2026, 0, 1);
const form = (overrides: Partial<AutomationFormState> = {}): AutomationFormState => ({
  id: null,
  name: "Build",
  cwd: "/project",
  runner: defaultRunnerForm(),
  enabled: true,
  timezone: "UTC",
  triggerType: "schedule",
  schedule: defaultScheduleForm(),
  watchRecursive: true,
  watchFilter: "",
  eventNames: ["git-commit"],
  limitMode: "forever",
  limitMax: 20,
  closeOnFinish: false,
  requestedSecrets: [],
  redactOutput: false,
  ...overrides,
});
afterEach(cleanup);

describe("automation agenda", () => {
  it("surfaces truncation and queued status before frequent dates, with technical help collapsed", () => {
    render(
      <AutomationAgenda
        automations={[
          automationFixture({
            trigger: {
              kind: "schedule",
              schedule: { kind: "interval", every: 40, unit: "minutes", anchorAt: now + 1 },
            },
            runs: [runFixture()],
          }),
        ]}
        nowMs={now}
        error={false}
        onRetry={() => {}}
        onSelect={() => {}}
      />,
    );
    const firstTime = document.querySelector("time")!;
    const notice = screen.getByText(/Limited preview: only the earliest 100/);
    expect(notice.compareDocumentPosition(firstTime) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    expect(screen.getByText("How this agenda works").closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^queued 1$/i }));
    const status = screen.getByText(/Automation status · 1 matching automations/);
    expect(status.closest("details")?.open).toBe(true);
    expect(
      status.compareDocumentPosition(document.querySelector("time")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("shows viewer zone, real times grouped by project, and navigates to automation", () => {
    const onSelect = vi.fn();
    render(
      <AutomationAgenda
        automations={[automationFixture()]}
        nowMs={now}
        error={false}
        onRetry={() => {}}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText(/Calendar times shown in your local zone/)).toBeDefined();
    expect(screen.getAllByText("/project/alpha").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("time")).toHaveLength(7);
    fireEvent.click(screen.getAllByRole("button", { name: /open Nightly build scheduled/ })[0]);
    expect(onSelect).toHaveBeenCalledWith("build");
  });
  it("filters by search and status and explains no matches without inventing launches", () => {
    render(
      <AutomationAgenda
        automations={[
          automationFixture(),
          automationFixture({ id: "paused", name: "Paused build", enabled: false }),
        ]}
        nowMs={now}
        error={false}
        onRetry={() => {}}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^paused 1$/i }));
    expect(screen.getByText("No scheduled runs in the next 7 days")).toBeDefined();
    expect(document.querySelectorAll("time")).toHaveLength(0);
    expect(screen.getByText("Paused build")).toBeDefined();
    fireEvent.change(screen.getByRole("textbox", { name: "search upcoming automations" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No matching automations")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(document.querySelectorAll("time")).toHaveLength(7);
  });
  it("distinguishes loading, load failure with retry and empty state", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <AutomationAgenda
        automations={null}
        nowMs={now}
        error={false}
        onRetry={onRetry}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Loading upcoming automations…")).toBeDefined();
    rerender(
      <AutomationAgenda
        automations={null}
        nowMs={now}
        error
        onRetry={onRetry}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toBeDefined();
    rerender(
      <AutomationAgenda
        automations={[]}
        nowMs={now}
        error={false}
        onRetry={onRetry}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("No automations yet")).toBeDefined();
  });
});

describe("schedule preview and policies", () => {
  it("previews an interval without a schedule zone in explicitly labeled browser-local time", () => {
    render(
      <AutomationSchedulePreview
        form={form({
          timezone: undefined,
          schedule: {
            ...defaultScheduleForm(),
            frequency: "interval",
            intervalEvery: 17,
            intervalUnit: "minutes",
            intervalAnchorAt: now + 1234,
          },
        })}
        nowMs={now}
        onChange={() => {}}
      />,
    );
    expect(document.querySelectorAll("time")).toHaveLength(4);
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe(
      new Date(now + 1234).toISOString(),
    );
    expect(screen.getByText(/Display zone: browser local/)).toBeDefined();
  });

  it("requires Reset for finished automations even after the form limit is raised", () => {
    render(
      <AutomationSchedulePreview
        form={form({ lifecycle: "finished", runCount: 5, limitMode: "count", limitMax: 10 })}
        nowMs={now}
        onChange={() => {}}
      />,
    );
    expect(document.querySelectorAll("time")).toHaveLength(0);
    expect(screen.getByText(/saving a higher limit does not resume/)).toBeDefined();
    expect(screen.getByText(/No automatic launches are planned until Reset/)).toBeDefined();
  });

  it("preserves unusual saved zones and offers explicit local detection", () => {
    const onChange = vi.fn();
    render(
      <AutomationSchedulePreview
        form={form({ timezone: "Pacific/Chatham" })}
        nowMs={now}
        onChange={onChange}
      />,
    );
    expect((screen.getByLabelText("Schedule time zone") as HTMLInputElement).value).toBe(
      "Pacific/Chatham",
    );
    expect(document.querySelector('option[value="Pacific/Chatham"]')).not.toBeNull();
    expect(document.querySelectorAll("time")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Use my zone" }));
    expect(onChange.mock.calls[0][0].timezone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
  it("shows inline validation and no false preview; respects remaining limits", () => {
    const { rerender } = render(
      <AutomationSchedulePreview
        form={form({ timezone: "invalid/zone" })}
        nowMs={now}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("IANA");
    expect(document.querySelectorAll("time")).toHaveLength(0);
    rerender(
      <AutomationSchedulePreview
        form={form({ limitMode: "count", limitMax: 5, runCount: 4 })}
        nowMs={now}
        onChange={() => {}}
      />,
    );
    expect(document.querySelectorAll("time")).toHaveLength(1);
    rerender(
      <AutomationSchedulePreview
        form={form({ timezone: undefined })}
        nowMs={now}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/leaving this unchanged preserves the legacy setting/)).toBeDefined();
  });
  it("defaults skip policies and disables overlap for a thread, including old allow", () => {
    const { rerender } = render(<AutomationSafetyFields form={form()} onChange={() => {}} />);
    expect(
      (screen.getByRole("radio", { name: /Skip the new run/ }) as HTMLInputElement).checked,
    ).toBe(true);
    rerender(
      <AutomationSafetyFields
        form={form({
          runner: { ...defaultRunnerForm(), runnerType: "agent", agentSessionMode: "thread" },
          concurrencyPolicy: "allow",
        })}
        onChange={() => {}}
      />,
    );
    expect(
      (screen.getByRole("radio", { name: /Run alongside it/ }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("radio", { name: /Wait, then run the latest/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});

describe("queued and interrupted detail", () => {
  it("separates waiting work, disables destructive actions, cancels queued only and retains logs", () => {
    const onCancel = vi.fn();
    const onOpenLog = vi.fn();
    const queued = runFixture();
    const interrupted = runFixture({
      runId: "interrupted",
      status: "interrupted",
      reason: "restart",
      hasLog: true,
    });
    render(
      <AutomationDetail
        automation={automationFixture({ runs: [queued, interrupted] })}
        nowMs={now}
        armedDelete={false}
        onRunNow={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onToggleEnabled={() => {}}
        onReset={() => {}}
        armedClearThread={false}
        onClearHistory={() => {}}
        armedClear={false}
        onOpenLog={onOpenLog}
        onCancelQueued={onCancel}
        runFeedback="Run queued — waiting for current work."
      />,
    );
    expect(screen.getByText("Queued — not started")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "cancel queued run run-1" })
        .compareDocumentPosition(screen.getByText("When it runs & what happens if it can’t")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.getByText(/Needs attention: an interrupted run/)).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "delete Nightly build" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "cancel queued run run-1" }));
    expect(onCancel).toHaveBeenCalledWith(queued);
    expect(screen.queryByRole("button", { name: "cancel queued run interrupted" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /interrupted · needs attention/ }));
    expect(onOpenLog).toHaveBeenCalledWith(interrupted);
  });
});
