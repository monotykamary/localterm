import type { GitDiffFileMeta } from "@monotykamary/localterm-server/protocol";
import { isImagePath } from "@monotykamary/localterm-server/protocol";

interface OpenDiffFileAction {
  handler: (filePath: string) => void;
  label: string;
  ariaLabel: (path: string) => string;
}

// Picks the open-file action for the header button: images open in a new tab
// (the server serves the bytes directly), text files open in neovim, and
// non-image binaries get no button. Returns null when nothing applies or no
// handler is wired.
export const resolveOpenDiffFileAction = (
  file: GitDiffFileMeta,
  onOpenInEditor: ((filePath: string) => void) | undefined,
  onOpenImage: ((filePath: string) => void) | undefined,
): OpenDiffFileAction | null => {
  const image = isImagePath(file.path);
  const handler = image ? onOpenImage : onOpenInEditor;
  if (!handler) return null;
  if (!image && file.binary) return null;
  return image
    ? { handler, label: "open image", ariaLabel: (path) => `open image ${path}` }
    : { handler, label: "open in neovim", ariaLabel: (path) => `open ${path} in neovim` };
};
