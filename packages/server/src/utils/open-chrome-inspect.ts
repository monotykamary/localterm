import { spawn } from "node:child_process";
import open from "open";
import { getBrowserCandidates } from "../cdp/detect-chromium.js";

// chrome://inspect with the #remote-debugging fragment jumps straight to the
// "Discover network targets" section the user needs to toggle.
const CHROME_INSPECT_URL = "chrome://inspect/#remote-debugging";

// The candidate `name` is a display label; the macOS application process name
// usually matches, but Brave's app is "Brave Browser".
const darwinAppName = (candidateName: string): string =>
  candidateName === "Brave" ? "Brave Browser" : candidateName;

// Open chrome://inspect in the user's browser. This is the bootstrap path for
// users who haven't enabled remote debugging yet, so it must NOT go through CDP.
// chrome:// URLs can't be navigated to from a web page and have no registered
// URL-scheme handler on the OS, so the daemon targets a running Chromium app by
// name — picked dynamically (never assumed): the frontmost one (the browser the
// user is viewing localterm in), falling back to the first running candidate.
//
// macOS: AppleScript `open location` addressed to the chosen app reuses its
// current profile (avoids the profile picker that `open -a` triggers). Elsewhere
// we fall back to the OS opener. Best-effort — never throws.
export const openChromeInspect = async (): Promise<void> => {
  try {
    if (process.platform === "darwin") {
      const apps = getBrowserCandidates().map((candidate) => darwinAppName(candidate.name));
      await runOsascript(darwinOpenInspectScript(CHROME_INSPECT_URL, apps));
      return;
    }
    await open(CHROME_INSPECT_URL);
  } catch {
    /* best-effort — the user can open the page manually */
  }
};

const darwinOpenInspectScript = (url: string, apps: readonly string[]): string => `
set inspectURL to "${url}"
set browserApps to {${apps.map((app) => `"${app}"`).join(", ")}}
set target to ""
tell application "System Events"
\tset frontApp to name of first application process whose frontmost is true
\tif frontApp is in browserApps then
\t\tset target to frontApp
\telse
\t\trepeat with appName in browserApps
\t\t\tif exists process appName then
\t\t\t\tset target to appName
\t\t\t\texit repeat
\t\t\tend if
\t\tend repeat
\tend if
end tell
if target is not "" then
\ttell application target to open location inspectURL
end if
`;

const runOsascript = (script: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("osascript", { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`osascript exited with ${code}`));
    });
    child.stdin?.end(script);
  });
