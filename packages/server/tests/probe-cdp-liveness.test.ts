import { describe, expect, it, vi } from "vite-plus/test";
import type { DetectedBrowser } from "../src/cdp/detect-chromium.js";
import { probeCdpLiveness } from "../src/cdp/probe-cdp-liveness.js";

const browser = (name: string, port: number, mtimeMs = 0): DetectedBrowser => ({
  name,
  profileDir: `/tmp/${name}`,
  port,
  wsPath: `/devtools/browser/${name}`,
  wsUrl: `ws://127.0.0.1:${port}/devtools/browser/${name}`,
  mtimeMs,
});

describe("probeCdpLiveness", () => {
  it("returns the first candidate whose port accepts a connection", async () => {
    const chrome = browser("Google Chrome", 9222, 2);
    const brave = browser("Brave", 9223, 1);
    const isLive = vi.fn(async (candidate: DetectedBrowser) => candidate.port === chrome.port);
    const result = await probeCdpLiveness([chrome, brave], { isLive });
    expect(result).toBe(chrome);
    expect(isLive).toHaveBeenCalledTimes(1);
  });

  it("skips a stale candidate and falls through to the next live one", async () => {
    // Dia's file is stale (most-recent mtime, ranked first) but its port is
    // dead; Chrome is live and ranked second.
    const dia = browser("Dia", 9222, 3);
    const chrome = browser("Google Chrome", 9223, 2);
    const isLive = vi.fn(async (candidate: DetectedBrowser) => candidate.port === chrome.port);
    const result = await probeCdpLiveness([dia, chrome], { isLive });
    expect(result).toBe(chrome);
    expect(isLive).toHaveBeenNthCalledWith(1, dia, expect.any(Number));
    expect(isLive).toHaveBeenNthCalledWith(2, chrome, expect.any(Number));
  });

  it("returns undefined when no candidate's port accepts a connection", async () => {
    const dia = browser("Dia", 9222, 1);
    const chrome = browser("Google Chrome", 9223, 0);
    const isLive = vi.fn(async () => false);
    const result = await probeCdpLiveness([dia, chrome], { isLive });
    expect(result).toBeUndefined();
    expect(isLive).toHaveBeenCalledTimes(2);
  });

  it("returns undefined for an empty candidate list", async () => {
    const isLive = vi.fn(async () => true);
    const result = await probeCdpLiveness([], { isLive });
    expect(result).toBeUndefined();
    expect(isLive).not.toHaveBeenCalled();
  });
});
