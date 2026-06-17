import type { DiffLine } from "@/utils/parse-unified-diff";

export const addedLineKey = (line: DiffLine): string =>
  `${line.newLine}:${line.text}:${line.noNewline ? 1 : 0}`;

export const lineKey = (line: DiffLine): string =>
  `${line.type}:${line.oldLine ?? "-"}:${line.newLine ?? "-"}:${line.text}:${line.noNewline ? 1 : 0}`;
