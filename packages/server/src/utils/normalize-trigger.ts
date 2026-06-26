import type { AutomationTrigger, TriggerInput } from "../types.js";
import { normalizeScheduleInput } from "./compile-schedule.js";
import { generateWebhookId } from "./generate-webhook-id.js";

// The trigger-level counterpart of normalizeScheduleInput: default watch's
// `recursive`, normalize a schedule trigger's payload (recognizing a bare cron
// string as a friendly preset), and materialize a webhook trigger's
// server-owned id. Lives apart from compile-schedule.ts (which the terminal app
// imports for cron preview) so the node:crypto-backed id generator never reaches
// the browser bundle. The store finalizes the id (preserving an existing one on
// a PATCH that keeps the webhook kind, else guaranteeing uniqueness).
export const normalizeTriggerInput = (trigger: TriggerInput): AutomationTrigger =>
  trigger.kind === "watch"
    ? {
        kind: "watch",
        recursive: trigger.recursive ?? true,
        ...(trigger.filter ? { filter: trigger.filter } : {}),
      }
    : trigger.kind === "event"
      ? { kind: "event", events: trigger.events }
      : trigger.kind === "webhook"
        ? { kind: "webhook", id: generateWebhookId() }
        : { kind: "schedule", schedule: normalizeScheduleInput(trigger.schedule) };
