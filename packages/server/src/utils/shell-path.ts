import { PTY_BASE_PATH } from "../constants.js";

// User shells set their own PATH via rc files; see PTY_BASE_PATH for why the
// daemon's baked PATH must not leak into them. LOCALTERM_PTY_FULL_PATH=1 opts
// back into inheriting the daemon's PATH verbatim (the pre-fix behavior).
export const shellPathForUserShell = (): string =>
  process.env.LOCALTERM_PTY_FULL_PATH === "1" ? (process.env.PATH ?? PTY_BASE_PATH) : PTY_BASE_PATH;
