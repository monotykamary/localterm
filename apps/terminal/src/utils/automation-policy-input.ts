import type { AutomationFormState } from "@/lib/automation-form-state";

export const automationPolicyInput = (
  form: Pick<AutomationFormState, "timezone" | "concurrencyPolicy" | "missedRunPolicy" | "runner">,
) => ({
  ...(form.timezone === undefined ? {} : { timezone: form.timezone.trim() }),
  concurrencyPolicy:
    form.runner.runnerType === "agent" &&
    form.runner.agentSessionMode === "thread" &&
    form.concurrencyPolicy === "allow"
      ? ("queue-latest" as const)
      : (form.concurrencyPolicy ?? "skip"),
  missedRunPolicy: form.missedRunPolicy ?? "skip",
});
