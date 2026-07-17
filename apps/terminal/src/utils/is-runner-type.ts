import type { RunnerType } from "@/utils/runner-form";

export const isRunnerType = (value: string | null): value is RunnerType =>
  value === "shell" || value === "agent";
