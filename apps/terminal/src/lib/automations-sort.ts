export const AUTOMATIONS_SORT_OPTIONS = ["last-run", "created", "name"] as const;

export type AutomationsSort = (typeof AUTOMATIONS_SORT_OPTIONS)[number];
