import { describe, expect, it } from "vite-plus/test";
import type { DetectedBrowser } from "@monotykamary/localterm-server";
import { probeCdpAvailability } from "../../src/utils/probe-cdp-availability.js";

const browser = (name: string, port: number, mtimeMs: number): DetectedBrowser => ({
  name,
  profileDir: `/tmp/${name}`,
  port,
  wsPath: `/devtools/browser/${name}`,
  wsUrl: `ws://127.0.0.1:${port}/devtools/browser/${name}`,
  mtimeMs,
});

describe("probeCdpAvailability", () => {
  it("reports available with the most-recently-launched browser", async () => {
    const detect = async (): Promise<DetectedBrowser[]> => [
      browser("Google Chrome", 9222, 2),
      browser("Brave", 9223, 1),
    ];
    const result = await probeCdpAvailability(detect);
    expect(result).toEqual({ available: true, browserName: "Google Chrome" });
  });

  it("reports unavailable when no debug-enabled browser is detected", async () => {
    const result = await probeCdpAvailability(async () => []);
    expect(result).toEqual({ available: false });
  });
});
