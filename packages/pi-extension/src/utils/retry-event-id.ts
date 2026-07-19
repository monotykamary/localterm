export const retryEventId = (event: unknown): number | undefined => {
  if (typeof event !== "object" || event === null || !("retryId" in event)) return undefined;
  return typeof event.retryId === "number" ? event.retryId : undefined;
};
