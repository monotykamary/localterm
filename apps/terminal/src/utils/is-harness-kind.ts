import type { HarnessKind } from "@/utils/runner-form";

export const isHarnessKind = (value: string | null): value is HarnessKind =>
  value === "pi" || value === "custom";
