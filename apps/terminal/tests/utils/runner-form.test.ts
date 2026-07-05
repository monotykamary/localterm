import { describe, expect, it } from "vite-plus/test";
import {
  buildRunnerFromForm,
  defaultRunnerForm,
  isRunnerFormValid,
  recognizeRunnerForm,
  runnerSummary,
  runnerTypeLabel,
  type RunnerFormState,
} from "../../src/utils/runner-form";

const PI_HARNESS = { kind: "pi", extensions: true, skills: true, contextFiles: true } as const;

const agentForm = (overrides: Partial<RunnerFormState> = {}): RunnerFormState => ({
  ...defaultRunnerForm(),
  runnerType: "agent",
  prompt: "review commits",
  agentSessionMode: "fresh",
  ...overrides,
});

describe("runner-form", () => {
  it("builds a shell runner from the form", () => {
    const form = { ...defaultRunnerForm(), command: "pnpm build" };
    expect(buildRunnerFromForm(form)).toEqual({ kind: "shell", command: "pnpm build" });
  });

  it("builds a fresh agent runner with the default pi harness", () => {
    expect(buildRunnerFromForm(agentForm({ prompt: "go" }))).toEqual({
      kind: "agent",
      prompt: "go",
      sessionMode: "fresh",
      harness: PI_HARNESS,
    });
  });

  it("builds a thread agent runner with model, thinking, and a custom harness", () => {
    expect(
      buildRunnerFromForm(
        agentForm({
          prompt: "go",
          agentSessionMode: "thread",
          agentModel: "anthropic/claude-opus-4-5",
          agentThinking: "high",
          harnessKind: "custom",
          customCommand: 'claude -p "$LOCALTERM_AGENT_PROMPT"',
          customCompactCommand: "claude --compact",
        }),
      ),
    ).toEqual({
      kind: "agent",
      prompt: "go",
      sessionMode: "thread",
      model: "anthropic/claude-opus-4-5",
      thinking: "high",
      harness: {
        kind: "custom",
        command: 'claude -p "$LOCALTERM_AGENT_PROMPT"',
        compactCommand: "claude --compact",
      },
    });
  });

  it("omits a blank custom compactCommand", () => {
    const runner = buildRunnerFromForm(
      agentForm({ harnessKind: "custom", customCommand: "my-agent", customCompactCommand: "  " }),
    );
    expect(runner.kind === "agent" && runner.harness.kind === "custom").toBe(true);
    if (runner.kind === "agent" && runner.harness.kind === "custom") {
      expect(runner.harness.compactCommand).toBeUndefined();
    }
  });

  it("trims the prompt and command and skips blank optional fields", () => {
    expect(
      buildRunnerFromForm(agentForm({ prompt: "  go  ", agentModel: "   ", agentThinking: "" })),
    ).toEqual({
      kind: "agent",
      prompt: "go",
      sessionMode: "fresh",
      harness: PI_HARNESS,
    });
  });

  it("recognizes a shell runner back into the form", () => {
    const form = recognizeRunnerForm({ kind: "shell", command: "pnpm build" });
    expect(form.runnerType).toBe("shell");
    expect(form.command).toBe("pnpm build");
    expect(form.prompt).toBe("");
  });

  it("recognizes an agent runner with a custom harness back into the form", () => {
    const form = recognizeRunnerForm({
      kind: "agent",
      prompt: "review",
      sessionMode: "thread",
      model: "anthropic/claude-opus-4-5",
      thinking: "high",
      harness: { kind: "custom", command: "my-agent", compactCommand: "my-compact" },
    });
    expect(form.runnerType).toBe("agent");
    expect(form.prompt).toBe("review");
    expect(form.agentSessionMode).toBe("thread");
    expect(form.harnessKind).toBe("custom");
    expect(form.customCommand).toBe("my-agent");
    expect(form.customCompactCommand).toBe("my-compact");
  });

  it("recognizes a pi harness with extensions disabled", () => {
    const form = recognizeRunnerForm({
      kind: "agent",
      prompt: "review",
      sessionMode: "fresh",
      harness: { kind: "pi", extensions: false, skills: true, contextFiles: false },
    });
    expect(form.harnessKind).toBe("pi");
    expect(form.piExtensions).toBe(false);
    expect(form.piContextFiles).toBe(false);
    expect(form.piSkills).toBe(true);
  });

  it("validates a non-empty prompt for agent and command for shell, and a custom command", () => {
    expect(isRunnerFormValid({ ...defaultRunnerForm(), command: "x" })).toBe(true);
    expect(isRunnerFormValid({ ...defaultRunnerForm(), command: "  " })).toBe(false);
    expect(isRunnerFormValid(agentForm({ prompt: "x" }))).toBe(true);
    expect(isRunnerFormValid(agentForm({ prompt: "  " }))).toBe(false);
    expect(
      isRunnerFormValid({
        ...agentForm({ prompt: "x", harnessKind: "custom", customCommand: "" }),
      }),
    ).toBe(false);
    expect(
      isRunnerFormValid(
        agentForm({ prompt: "x", harnessKind: "custom", customCommand: "my-agent" }),
      ),
    ).toBe(true);
  });

  it("labels and summarizes shell and agent runners", () => {
    expect(runnerTypeLabel({ kind: "shell", command: "x" })).toBe("Shell");
    expect(
      runnerTypeLabel({
        kind: "agent",
        prompt: "x",
        sessionMode: "fresh",
        harness: PI_HARNESS,
      }),
    ).toBe("Agent");
    expect(runnerSummary({ kind: "shell", command: "pnpm build" })).toBe("pnpm build");
    expect(
      runnerSummary({
        kind: "agent",
        prompt: "review",
        sessionMode: "fresh",
        harness: PI_HARNESS,
      }),
    ).toBe("review");
  });
});
