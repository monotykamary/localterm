import { spawn } from "node:child_process";
import open from "open";
import { getBrowserCandidates } from "../cdp/detect-chromium.js";
import { findBinaryOnPath } from "./find-binary-on-path.js";

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
// URL-scheme handler on the OS, so the daemon targets a Chromium app — picked
// dynamically (never assumed): the frontmost one (the browser the user is
// viewing localterm in), falling back to the first running candidate.
//
// macOS: AppleScript `open location` addressed to the chosen app reuses its
// current profile (avoids the profile picker that `open -a` triggers).
// Linux: xdg-open has no chrome:// handler, so invoke the browser binary
// directly with the URL — a running Chromium reuses the existing instance's
// profile and opens a new tab (the same profile-reuse behavior the macOS
// AppleScript buys us). The first installed candidate wins; priority order
// matches the DevToolsActivePort scan.
// Elsewhere we fall back to the OS opener. Best-effort — never throws.
export const openChromeInspect = async (): Promise<void> => {
  try {
    if (process.platform === "darwin") {
      const apps = getBrowserCandidates().map((candidate) => darwinAppName(candidate.name));
      await runOsascript(darwinOpenInspectScript(CHROME_INSPECT_URL, apps));
      return;
    }
    if (process.platform === "linux") {
      const binary = findInstalledLinuxBrowserBinary();
      if (binary !== null) {
        // Fire-and-forget: the browser owns its own lifecycle and must outlive
        // the daemon. detached + unref lets the daemon exit without waiting.
        spawn(binary, [CHROME_INSPECT_URL], { stdio: "ignore", detached: true }).unref();
        return;
      }
    }
    await open(CHROME_INSPECT_URL);
  } catch {
    /* best-effort — the user can open the page manually */
  }
};

// Candidate browser name -> the binary names it ships as on Linux, in the
// order to prefer (stable over canary, non-suffixed over -stable where both
// exist). Names align with the linux branch of getBrowserCandidates so the
// DevToolsActivePort scan and the launcher agree on which browsers localterm
// looks for.
const LINUX_BROWSER_BINARIES: Readonly<Record<string, readonly string[]>> = {
  "Google Chrome": ["google-chrome-stable", "google-chrome"],
  "Google Chrome Canary": ["google-chrome-unstable", "google-chrome-canary"],
  Chromium: ["chromium", "chromium-browser"],
  "Microsoft Edge": ["microsoft-edge", "microsoft-edge-stable"],
  Brave: ["brave-browser", "brave"],
  Dia: ["dia"],
  Vivaldi: ["vivaldi"],
  Opera: ["opera", "opera-stable"],
  Aside: ["aside"],
};

// First candidate browser binary that's executable on PATH, scanning browsers
// in DevToolsActivePort-scan priority order. Resolves to the absolute path so
// the spawn isn't PATH-dependent at exec time. Null when no Chromium binary is
// installed (the caller then falls back to the OS opener).
const findInstalledLinuxBrowserBinary = (): string | null => {
  const binaries: string[] = [];
  for (const candidate of getBrowserCandidates()) {
    for (const binary of LINUX_BROWSER_BINARIES[candidate.name] ?? []) {
      if (!binaries.includes(binary)) binaries.push(binary);
    }
  }
  for (const binary of binaries) {
    const resolved = findBinaryOnPath(binary);
    if (resolved !== null) return resolved;
  }
  return null;
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
