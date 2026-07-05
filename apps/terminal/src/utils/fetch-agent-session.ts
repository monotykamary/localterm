import type { AgentSessionEntry } from "@monotykamary/localterm-server/protocol";

// Fetch the thread-mode session transcript for a run. `runId` truncates the
// transcript at that run's point in time (its finishedAt), so an older run
// shows the branch as it was then, not the latest state.
export const fetchAgentSession = async (
  automationId: string,
  runId: string,
): Promise<AgentSessionEntry[]> => {
  const url = new URL(`/api/automations/${automationId}/session`, window.location.href);
  url.searchParams.set("runId", runId);
  const response = await fetch(url);
  if (!response.ok) return [];
  const body = (await response.json()) as { entries?: AgentSessionEntry[] };
  return body.entries ?? [];
};
