import { AUTOMATIONS_SORT_OPTIONS, type AutomationsSort } from "@/lib/automations-sort";

export const isAutomationsSort = (value: string | null): value is AutomationsSort =>
  value !== null && AUTOMATIONS_SORT_OPTIONS.some((option) => option === value);
