import {
  automationRunStatusSchema,
  type AutomationRunStatus,
} from "@monotykamary/localterm-server/protocol";

interface RunReceipt {
  runId: string;
  status: AutomationRunStatus;
}
export const triggerAutomationRun = async (id: string): Promise<RunReceipt | null> => {
  try {
    const response = await fetch(
      new URL(`/api/automations/${encodeURIComponent(id)}/run`, window.location.href),
      { method: "POST" },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return null;
    const runId: unknown = Reflect.get(body, "runId");
    const status = automationRunStatusSchema.safeParse(Reflect.get(body, "status"));
    return typeof runId === "string" && status.success ? { runId, status: status.data } : null;
  } catch {
    return null;
  }
};
