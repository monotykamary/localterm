import type { AutomationSessionEvent } from "@monotykamary/localterm-server/protocol";
import type { RunnerFormState } from "@/utils/runner-form";
import type { ScheduleFormState, TriggerType } from "@/utils/schedule-builder";

export interface AutomationFormState {
  id: string | null;
  name: string;
  runner: RunnerFormState;
  cwd: string;
  enabled: boolean;
  triggerType: TriggerType;
  schedule: ScheduleFormState;
  watchRecursive: boolean;
  watchFilter: string;
  eventNames: AutomationSessionEvent[];
  limitMode: "forever" | "count";
  limitMax: number;
  closeOnFinish: boolean;
  requestedSecrets: string[];
}
