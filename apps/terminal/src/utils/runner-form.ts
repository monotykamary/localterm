import type { AutomationRunner, RunnerInput } from "@monotykamary/localterm-server/protocol";

export type RunnerType = AutomationRunner["kind"];
type AgentSessionMode = "fresh" | "thread";
export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type HarnessKind = "pi" | "custom";

export interface RunnerFormState {
  runnerType: RunnerType;
  // Shell runner: the command typed into the PTY tab.
  command: string;
  // Agent runner: the prompt sent to the harness.
  prompt: string;
  agentSessionMode: AgentSessionMode;
  // Blank = the harness default model.
  agentModel: string;
  // Blank = the harness default thinking level.
  agentThinking: AgentThinkingLevel | "";
  harnessKind: HarnessKind;
  // Custom harness: the command run for each fire (prompt + metadata arrive as
  // LOCALTERM_AGENT_* env vars); compactCommand compacts a thread session.
  customCommand: string;
  customCompactCommand: string;
  // Pi harness toggles for the --no-extensions / --no-skills / --no-context-files
  // flags — for runs whose provider extensions misbehave headless.
  piExtensions: boolean;
  piSkills: boolean;
  piContextFiles: boolean;
}

export const defaultRunnerForm = (): RunnerFormState => ({
  runnerType: "shell",
  command: "",
  prompt: "",
  agentSessionMode: "fresh",
  agentModel: "",
  agentThinking: "",
  harnessKind: "pi",
  customCommand: "",
  customCompactCommand: "",
  piExtensions: true,
  piSkills: true,
  piContextFiles: true,
});

export const recognizeRunnerForm = (runner: AutomationRunner): RunnerFormState => {
  if (runner.kind === "agent") {
    const base: RunnerFormState = {
      ...defaultRunnerForm(),
      runnerType: "agent",
      prompt: runner.prompt,
      agentSessionMode: runner.sessionMode,
      agentModel: runner.model ?? "",
      agentThinking: runner.thinking ?? "",
    };
    if (runner.harness.kind === "custom") {
      return {
        ...base,
        harnessKind: "custom",
        customCommand: runner.harness.command,
        customCompactCommand: runner.harness.compactCommand ?? "",
      };
    }
    return {
      ...base,
      harnessKind: "pi",
      piExtensions: runner.harness.extensions,
      piSkills: runner.harness.skills,
      piContextFiles: runner.harness.contextFiles,
    };
  }
  return { ...defaultRunnerForm(), runnerType: "shell", command: runner.command };
};

export const buildRunnerFromForm = (form: RunnerFormState): RunnerInput =>
  form.runnerType === "agent"
    ? {
        kind: "agent",
        prompt: form.prompt.trim(),
        sessionMode: form.agentSessionMode,
        ...(form.agentModel.trim() ? { model: form.agentModel.trim() } : {}),
        ...(form.agentThinking ? { thinking: form.agentThinking } : {}),
        harness:
          form.harnessKind === "custom"
            ? {
                kind: "custom",
                command: form.customCommand.trim(),
                ...(form.customCompactCommand.trim()
                  ? { compactCommand: form.customCompactCommand.trim() }
                  : {}),
              }
            : {
                kind: "pi",
                extensions: form.piExtensions,
                skills: form.piSkills,
                contextFiles: form.piContextFiles,
              },
      }
    : { kind: "shell", command: form.command.trim() };

// Whether the runner half of the form has a non-empty payload.
export const isRunnerFormValid = (form: RunnerFormState): boolean => {
  if (form.runnerType === "agent") {
    if (form.prompt.trim().length === 0) return false;
    if (form.harnessKind === "custom" && form.customCommand.trim().length === 0) return false;
    return true;
  }
  return form.command.trim().length > 0;
};

// A short label for the runner kind, used in list rows and the detail header.
export const runnerTypeLabel = (runner: AutomationRunner): string =>
  runner.kind === "shell" ? "Shell" : "Agent";

// The user-visible text of the runner (the command or the prompt), for search
// matching and the detail summary.
export const runnerSummary = (runner: AutomationRunner): string =>
  runner.kind === "shell" ? runner.command : runner.prompt;
