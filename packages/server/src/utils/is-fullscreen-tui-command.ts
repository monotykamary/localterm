import path from "node:path";

import { FULLSCREEN_TUI_COMMANDS } from "../constants.js";

// Whether an initial command launches a full-screen TUI (nvim/vim/less/htop/…),
// detected by the command's first token (basename). Such apps enter the
// alternate screen buffer and clear it, so the line discipline's echo of the
// typed command is invisible — they take the at-spawn PTY-write path instead of
// the hook-eval path (running a full-screen app inside a precmd / PROMPT_COMMAND
// / fish_prompt hook is fragile). Matched on the first token so
// `nvim file && exit` routes here but a worktree setup script or `git pull`
// doesn't.
export const isFullscreenTuiCommand = (command: string): boolean => {
  const firstToken = command.trim().split(/\s+/)[0] ?? "";
  return FULLSCREEN_TUI_COMMANDS.has(path.basename(firstToken));
};
