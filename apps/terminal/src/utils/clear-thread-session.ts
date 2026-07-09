export const clearThreadSession = async (
  automationId: string,
): Promise<{ ok: boolean; message?: string }> => {
  try {
    const response = await fetch(
      new URL(
        `/api/automations/${encodeURIComponent(automationId)}/clear-thread`,
        window.location.href,
      ),
      { method: "POST" },
    );
    if (response.ok) {
      const body = (await response.json()) as { ok?: boolean; message?: string };
      return { ok: true, message: body.message };
    }
    const body = (await response.json()) as { error?: string; message?: string };
    return { ok: false, message: body.message ?? body.error ?? `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};
