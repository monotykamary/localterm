type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLine: number | null;
  newLine: number | null;
  // `\ No newline at end of file` applied to this line.
  noNewline: boolean;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/**
 * Parse a single-file unified diff (`git diff --patch` chunk) into hunks.
 * File-level header lines (`diff --git`, `index`, `---`/`+++`, mode lines)
 * are skipped; only hunk content is returned.
 */
export const parseUnifiedDiff = (patch: string): DiffHunk[] => {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const rawLines = patch.split("\n");
  // A trailing newline produces one empty trailing element, not a diff line.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();

  for (const rawLine of rawLines) {
    const headerMatch = HUNK_HEADER_PATTERN.exec(rawLine);
    if (headerMatch) {
      oldLine = Number.parseInt(headerMatch[1], 10);
      newLine = Number.parseInt(headerMatch[2], 10);
      currentHunk = { header: rawLine, lines: [] };
      hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;
    const marker = rawLine[0];
    if (marker === "\\") {
      const previous = currentHunk.lines[currentHunk.lines.length - 1];
      if (previous) previous.noNewline = true;
      continue;
    }
    if (marker === "+") {
      currentHunk.lines.push({
        type: "add",
        text: rawLine.slice(1),
        oldLine: null,
        newLine,
        noNewline: false,
      });
      newLine += 1;
      continue;
    }
    if (marker === "-") {
      currentHunk.lines.push({
        type: "del",
        text: rawLine.slice(1),
        oldLine,
        newLine: null,
        noNewline: false,
      });
      oldLine += 1;
      continue;
    }
    // Context line (leading space; git may emit a fully empty line for an
    // empty context line in some merge formats — treat it the same way).
    currentHunk.lines.push({
      type: "context",
      text: marker === " " ? rawLine.slice(1) : rawLine,
      oldLine,
      newLine,
      noNewline: false,
    });
    oldLine += 1;
    newLine += 1;
  }

  return hunks;
};

export const countHunkLines = (hunks: readonly DiffHunk[]): number =>
  hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
