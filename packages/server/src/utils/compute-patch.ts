import { structuredPatch } from "diff";

export interface PatchResult {
  patchText: string;
  additions: number;
  deletions: number;
}

const MODE_REGULAR = "100644";

export const computePatchFromContents = (
  oldContent: string | null,
  newContent: string | null,
  oldPath: string | null,
  newPath: string | null,
  _oldMode: string | null = null,
  newMode: string | null = null,
  oldId: string | null = null,
  newId: string | null = null,
  isRename = false,
): PatchResult => {
  const effectiveOld = oldContent ?? "";
  const effectiveNew = newContent ?? "";
  const isAdded = oldContent === null && newContent !== null;
  const isDeleted = newContent === null && oldContent !== null;

  const aPath = oldPath ?? "/dev/null";
  const bPath = newPath ?? "/dev/null";

  const result = structuredPatch(aPath, bPath, effectiveOld, effectiveNew);

  if (result.hunks.length === 0 && !isAdded && !isDeleted && !isRename) {
    return { patchText: "", additions: 0, deletions: 0 };
  }

  const parts: string[] = [];

  if (isRename) {
    parts.push(`diff --git a/${oldPath} b/${newPath}`);
    parts.push("similarity index 100%");
    parts.push(`rename from ${oldPath}`);
    parts.push(`rename to ${newPath}`);
  } else if (isAdded) {
    parts.push(`diff --git a/${bPath} b/${bPath}`);
    parts.push(`new file mode ${newMode ?? MODE_REGULAR}`);
  } else if (isDeleted) {
    parts.push(`diff --git a/${aPath} b/${aPath}`);
    parts.push(`deleted file mode ${MODE_REGULAR}`);
  } else {
    parts.push(`diff --git a/${aPath} b/${bPath}`);
    const abbreviatedOld = (oldId ?? "").substring(0, 7);
    const abbreviatedNew = (newId ?? "").substring(0, 7);
    parts.push(`index ${abbreviatedOld}..${abbreviatedNew}`);
  }

  if (!isRename) {
    if (isAdded) {
      parts.push("--- /dev/null");
    } else {
      parts.push(`--- a/${aPath}`);
    }
    if (isDeleted) {
      parts.push("+++ /dev/null");
    } else {
      parts.push(`+++ b/${bPath}`);
    }
  }

  let additions = 0;
  let deletions = 0;

  for (const hunk of result.hunks) {
    const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    const bodyLines: string[] = [];
    for (const line of hunk.lines) {
      const marker = line[0];
      if (marker === "+") {
        additions += 1;
        bodyLines.push(line);
      } else if (marker === "-") {
        deletions += 1;
        bodyLines.push(line);
      } else if (marker === " ") {
        bodyLines.push(line);
      }
    }
    parts.push(hunkHeader);
    parts.push(bodyLines.join("\n"));
  }

  const patchText = parts.join("\n") + "\n";
  return { patchText, additions, deletions };
};
