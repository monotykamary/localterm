import type { AutomationRunWireRecord } from "@monotykamary/localterm-server/protocol";

export const formatAutomationRunTrigger = (trigger: AutomationRunWireRecord["trigger"]): string =>
  trigger === "manual"
    ? "manual"
    : trigger === "watch"
      ? "watch"
      : trigger === "event"
        ? "event"
        : trigger === "webhook"
          ? "webhook"
          : "scheduled";
