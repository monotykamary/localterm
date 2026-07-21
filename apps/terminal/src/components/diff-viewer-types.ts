import type { GitDiffFilePatch } from "@monotykamary/localterm-server/protocol";
import type { DiffLineRange } from "@/utils/diff-line-ranges";

// A multiline drag that just ended: the range the open annotation editor will
// attach to its annotation on save. `end` is the line the editor anchors to.
export interface PendingAnnotationRange extends DiffLineRange {
  filePath: string;
}

// Per-file patch fetched lazily when a file is selected.
export interface PatchEntry {
  state: "loading" | "loaded" | "error";
  data?: GitDiffFilePatch;
}

interface FileListScrollOptions {
  align?: "start" | "center" | "end" | "auto";
  behavior?: ScrollBehavior;
}

export interface FileListVirtualizerHandle {
  scrollToIndex: (index: number, options?: FileListScrollOptions) => void;
}
