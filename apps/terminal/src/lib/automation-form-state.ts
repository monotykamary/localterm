import type {
  AutomationLifecycle,
  AutomationSessionEvent,
} from "@monotykamary/localterm-server/protocol";
import type { RunnerFormState } from "@/utils/runner-form";
import type { ScheduleFormState, TriggerType } from "@/utils/schedule-builder";

export interface AutomationFormState {
  id: string | null;
  name: string;
  runner: RunnerFormState;
  cwd: string;
  enabled: boolean;
  timezone?: string;
  concurrencyPolicy?: "skip" | "queue-latest" | "allow";
  missedRunPolicy?: "skip" | "run-latest";
  triggerType: TriggerType;
  schedule: ScheduleFormState;
  watchRecursive: boolean;
  watchFilter: string;
  eventNames: AutomationSessionEvent[];
  limitMode: "forever" | "count";
  limitMax: number;
  runCount?: number;
  lifecycle?: AutomationLifecycle;
  closeOnFinish: boolean;
  requestedSecrets: string[];
  redactOutput: boolean;
}
