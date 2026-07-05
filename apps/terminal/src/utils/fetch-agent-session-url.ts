// Fetch a tab URL that opens the thread session interactively in pi (a new
// terminal tab in the automation's cwd running `pi --session <file>`). Returns
// null for non-thread automations or if the server declines.
export const fetchAgentSessionUrl = async (automationId: string): Promise<string | null> => {
  const response = await fetch(`/api/automations/${automationId}/agent-session-url`);
  if (!response.ok) return null;
  const body = (await response.json()) as { url?: string };
  return body.url ?? null;
};
