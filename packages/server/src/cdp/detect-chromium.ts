/**
 * Detect Chromium-based browsers that currently have remote debugging enabled.
 *
 * A browser writes a `DevToolsActivePort` file into its user-data dir while a
 * debug endpoint is live (the user toggled "Discover network targets" in
 * chrome://inspect, or launched with --remote-debugging-port). The file holds
 * the port on line 1 and the browser-level WebSocket path on line 2, which is
 * everything we need to open a CDP connection — no HTTP probe required.
 *
 * Ported from the browser-harness-js CDP SDK (Bun) to dependency-free Node.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type BrowserCandidate = { name: string; profileDir: string };

export type DetectedBrowser = {
  /** Short label, e.g. "Google Chrome", "Brave". */
  name: string;
  /** Absolute user-data dir that held the DevToolsActivePort file. */
  profileDir: string;
  /** Port from DevToolsActivePort line 1. */
  port: number;
  /** WebSocket path from DevToolsActivePort line 2. */
  wsPath: string;
  /** `ws://127.0.0.1:<port><wsPath>` — ready to connect. */
  wsUrl: string;
  /** DevToolsActivePort mtime (ms). Used to prefer the most-recently-launched. */
  mtimeMs: number;
};

/** OS-specific user-data dirs for Chromium-based browsers, rough popularity order. */
export const getBrowserCandidates = (
  home: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): BrowserCandidate[] => {
  const list: BrowserCandidate[] = [];
  const push = (name: string, profileDir: string) => list.push({ name, profileDir });

  if (platform === "darwin") {
    const base = `${home}/Library/Application Support`;
    push("Dia", `${base}/Dia/User Data`);
    push("Google Chrome", `${base}/Google/Chrome`);
    push("Chromium", `${base}/Chromium`);
    push("Microsoft Edge", `${base}/Microsoft Edge`);
    push("Brave", `${base}/BraveSoftware/Brave-Browser`);
    push("Arc", `${base}/Arc/User Data`);
    push("Vivaldi", `${base}/Vivaldi`);
    push("Opera", `${base}/com.operasoftware.Opera`);
    push("Comet", `${base}/Comet`);
    push("Aside", `${base}/Aside`);
    push("Google Chrome Canary", `${base}/Google/Chrome Canary`);
  } else if (platform === "linux") {
    const cfg = `${home}/.config`;
    push("Dia", `${cfg}/dia`);
    push("Google Chrome", `${cfg}/google-chrome`);
    push("Chromium", `${cfg}/chromium`);
    push("Microsoft Edge", `${cfg}/microsoft-edge`);
    push("Brave", `${cfg}/BraveSoftware/Brave-Browser`);
    push("Vivaldi", `${cfg}/vivaldi`);
    push("Opera", `${cfg}/opera`);
    push("Aside", `${cfg}/aside`);
    push("Google Chrome Canary", `${cfg}/google-chrome-unstable`);
  } else if (platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? `${home}\\AppData\\Local`;
    push("Dia", `${local}\\Dia\\User Data`);
    push("Aside", `${local}\\Aside`);
    push("Google Chrome", `${local}\\Google\\Chrome\\User Data`);
    push("Chromium", `${local}\\Chromium\\User Data`);
    push("Microsoft Edge", `${local}\\Microsoft\\Edge\\User Data`);
    push("Brave", `${local}\\BraveSoftware\\Brave-Browser\\User Data`);
    push("Arc", `${local}\\Arc\\User Data`);
    push("Vivaldi", `${local}\\Vivaldi\\User Data`);
    push("Opera", `${local}\\Opera Software\\Opera Stable`);
    push("Google Chrome Canary", `${local}\\Google\\Chrome SxS\\User Data`);
  }
  return list;
};

/** Parse `<profileDir>/DevToolsActivePort`; undefined if missing/malformed. */
const tryReadDevToolsActivePort = async (
  profileDir: string,
): Promise<{ port: number; wsPath: string; mtimeMs: number } | undefined> => {
  const file = path.join(profileDir, "DevToolsActivePort");
  try {
    const [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    const [portStr, wsPath] = text.trim().split("\n");
    const port = Number(portStr);
    if (!Number.isFinite(port)) return undefined;
    if (!wsPath || !wsPath.startsWith("/devtools/")) return undefined;
    return { port, wsPath, mtimeMs: stat.mtimeMs };
  } catch {
    return undefined;
  }
};

/**
 * Scan known user-data dirs and return every Chromium browser with a live
 * DevToolsActivePort, most-recently-launched first. Does NOT verify the WS
 * endpoint actually accepts — the caller does that by trying to connect.
 */
export const detectChromiumBrowsers = async (
  candidates: BrowserCandidate[] = getBrowserCandidates(),
): Promise<DetectedBrowser[]> => {
  const detected: DetectedBrowser[] = [];
  for (const { name, profileDir } of candidates) {
    const parsed = await tryReadDevToolsActivePort(profileDir);
    if (!parsed) continue;
    detected.push({
      name,
      profileDir,
      port: parsed.port,
      wsPath: parsed.wsPath,
      wsUrl: `ws://127.0.0.1:${parsed.port}${parsed.wsPath}`,
      mtimeMs: parsed.mtimeMs,
    });
  }
  detected.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return detected;
};
