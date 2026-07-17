const parseHunkHeader = (line) => {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) throw new Error(`Invalid hunk header: ${line}`);
  return Number.parseInt(match[1], 10);
};

export const reverseUnifiedPatch = (patchedSource, patchSource, filePath) => {
  const patchLines = patchSource.split("\n");
  const fileStart = patchLines.indexOf(`diff --git a/${filePath} b/${filePath}`);
  if (fileStart === -1) throw new Error(`Patch does not contain ${filePath}`);
  const nextFile = patchLines.findIndex(
    (line, index) => index > fileStart && line.startsWith("diff --git "),
  );
  const filePatchLines = patchLines.slice(fileStart, nextFile === -1 ? undefined : nextFile);
  const patchedLines = patchedSource.split("\n");
  const restoredLines = [];
  let patchedIndex = 0;

  for (let patchIndex = 0; patchIndex < filePatchLines.length; patchIndex++) {
    const header = filePatchLines[patchIndex];
    if (!header.startsWith("@@ ")) continue;
    const hunkStart = parseHunkHeader(header) - 1;
    restoredLines.push(...patchedLines.slice(patchedIndex, hunkStart));
    patchedIndex = hunkStart;

    for (patchIndex += 1; patchIndex < filePatchLines.length; patchIndex++) {
      const patchLine = filePatchLines[patchIndex];
      if (patchLine.startsWith("@@ ")) {
        patchIndex -= 1;
        break;
      }
      if (patchLine === "\\ No newline at end of file") continue;
      const marker = patchLine[0];
      const content = patchLine.slice(1);
      if (marker === " " || marker === "+") {
        if (patchedLines[patchedIndex] !== content) {
          throw new Error(
            `Patch mismatch at ${filePath}:${patchedIndex + 1}: expected ${JSON.stringify(content)}`,
          );
        }
        if (marker === " ") restoredLines.push(content);
        patchedIndex += 1;
      } else if (marker === "-") {
        restoredLines.push(content);
      }
    }
  }

  restoredLines.push(...patchedLines.slice(patchedIndex));
  return restoredLines.join("\n");
};
