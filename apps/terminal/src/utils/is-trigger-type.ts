import type { TriggerType } from "@/utils/schedule-builder";

export const isTriggerType = (value: string | null): value is TriggerType =>
  value === "schedule" || value === "watch" || value === "event" || value === "webhook";
