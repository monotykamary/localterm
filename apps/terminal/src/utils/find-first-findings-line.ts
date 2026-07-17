import { AUTOMATION_FINDINGS_PREVIEW_MAX_CHARACTERS } from "@/lib/constants";

export const findFirstFindingsLine = (findings: string | null): string => {
  if (!findings) return "";
  const line = findings.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  return line.trim().slice(0, AUTOMATION_FINDINGS_PREVIEW_MAX_CHARACTERS);
};
