import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type BrowserCandidate,
  detectChromiumBrowsers,
  getBrowserCandidates,
} from "../src/cdp/detect-chromium.js";

const writeActivePort = (profileDir: string, contents: string): void => {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "DevToolsActivePort"), contents);
};

describe("getBrowserCandidates", () => {
  it("maps Chrome's user-data dir per platform", () => {
    const mac = getBrowserCandidates("/Users/me", "darwin");
    expect(mac).toContainEqual({
      name: "Google Chrome",
      profileDir: "/Users/me/Library/Application Support/Google/Chrome",
    });

    const linux = getBrowserCandidates("/home/me", "linux");
    expect(linux).toContainEqual({
      name: "Google Chrome",
      profileDir: "/home/me/.config/google-chrome",
    });
  });

  it("includes Aside's user-data dir (Aside exposes CDP on an ephemeral port like 52860)", () => {
    const mac = getBrowserCandidates("/Users/me", "darwin");
    expect(mac).toContainEqual({
      name: "Aside",
      profileDir: "/Users/me/Library/Application Support/Aside",
    });

    const linux = getBrowserCandidates("/home/me", "linux");
    expect(linux).toContainEqual({
      name: "Aside",
      profileDir: "/home/me/.config/aside",
    });
  });
});

describe("detectChromiumBrowsers", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-detect-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("parses a well-formed DevToolsActivePort into a ws URL", async () => {
    const profileDir = path.join(root, "chrome");
    writeActivePort(profileDir, "9222\n/devtools/browser/abc-123\n");

    const detected = await detectChromiumBrowsers([{ name: "Google Chrome", profileDir }]);

    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({
      name: "Google Chrome",
      port: 9222,
      wsPath: "/devtools/browser/abc-123",
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/abc-123",
    });
  });

  it("skips missing and malformed profiles", async () => {
    const ok = path.join(root, "ok");
    writeActivePort(ok, "9333\n/devtools/browser/live\n");
    const noPath = path.join(root, "no-path");
    writeActivePort(noPath, "9444\n"); // missing ws path line
    const badPort = path.join(root, "bad-port");
    writeActivePort(badPort, "not-a-port\n/devtools/browser/x\n");
    const wrongPrefix = path.join(root, "wrong-prefix");
    writeActivePort(wrongPrefix, "9555\n/json/version\n"); // not a /devtools/ path

    const detected = await detectChromiumBrowsers([
      { name: "ok", profileDir: ok },
      { name: "no-path", profileDir: noPath },
      { name: "bad-port", profileDir: badPort },
      { name: "wrong-prefix", profileDir: wrongPrefix },
      { name: "absent", profileDir: path.join(root, "does-not-exist") },
    ]);

    expect(detected.map((b) => b.name)).toEqual(["ok"]);
  });

  it("orders most-recently-launched first", async () => {
    const older = path.join(root, "older");
    const newer = path.join(root, "newer");
    writeActivePort(older, "9222\n/devtools/browser/older\n");
    writeActivePort(newer, "9223\n/devtools/browser/newer\n");
    // Force a stale mtime on the "older" file so ordering is deterministic.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(older, "DevToolsActivePort"), past, past);

    const candidates: BrowserCandidate[] = [
      { name: "older", profileDir: older },
      { name: "newer", profileDir: newer },
    ];
    const detected = await detectChromiumBrowsers(candidates);

    expect(detected.map((b) => b.name)).toEqual(["newer", "older"]);
  });
});
