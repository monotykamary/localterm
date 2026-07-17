import type { AutomationRunRecord } from "@monotykamary/localterm-server/protocol";

export const formatAutomationRunTrigger = (trigger: AutomationRunRecord["trigger"]): string =>
  trigger === "manual"
    ? "manual"
    : trigger === "watch"
      ? "watch"
      : trigger === "event"
        ? "event"
        : trigger === "webhook"
          ? "webhook"
          : "scheduled";
