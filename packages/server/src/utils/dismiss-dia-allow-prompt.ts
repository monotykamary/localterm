import { execFile } from "node:child_process";

// Dia (The Browser Company) is the only Chromium browser that gates the CDP
// WebSocket open behind an "Allow debugging connection?" prompt, whose default
// button is Return. Send one Return to the Dia process via osascript so the
// daemon's persistent CDP socket connects with no manual click.
//
// Fire-and-forget: osascript errors are non-fatal. The one that matters is
// -25211 ("not allowed assistive access"), fired when macOS Accessibility
// hasn't been granted to the node binary running the daemon — without it the
// keystroke is dropped and the caller's connect just waits on its own timeout,
// exactly as if the feature weren't on, so default-on can't make things worse.
// No-op off macOS; the caller (CdpClient.openSocket) already gates on the
// connected browser being Dia, so the Dia process name is hardcoded here.
export const dismissDiaAllowPrompt = (platform: NodeJS.Platform = process.platform): void => {
  if (platform !== "darwin") return;
  try {
    execFile(
      "osascript",
      [
        "-e",
        'tell application "System Events"',
        "-e",
        "try",
        "-e",
        'set frontmost of process "Dia" to true',
        "-e",
        "end try",
        "-e",
        'tell process "Dia" to keystroke return',
        "-e",
        "end tell",
      ],
      () => {
        /* fire-and-forget; osascript errors are non-fatal */
      },
    );
  } catch {
    /* spawn failure — best effort */
  }
};
