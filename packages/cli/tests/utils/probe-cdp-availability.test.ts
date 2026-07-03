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
  it("reports available with the live browser the liveness probe confirms", async () => {
    const detect = async (): Promise<DetectedBrowser[]> => [
      browser("Google Chrome", 9222, 2),
      browser("Brave", 9223, 1),
    ];
    const probeLiveness = async (candidates: DetectedBrowser[]) => candidates[0];
    const result = await probeCdpAvailability(null, detect, probeLiveness);
    expect(result).toEqual({ available: true, browserName: "Google Chrome" });
  });

  it("skips a stale file-scan candidate and reports the next live one", async () => {
    // Dia's DevToolsActivePort file is stale (crashed browser, nothing on the
    // port) but still ranked first by mtime; the liveness probe must drop it
    // and fall through to the actually-running Chrome.
    const detect = async (): Promise<DetectedBrowser[]> => [
      browser("Dia", 9222, 3),
      browser("Google Chrome", 9223, 2),
    ];
    const probeLiveness = async (candidates: DetectedBrowser[]) =>
      candidates.find((candidate) => candidate.name === "Google Chrome");
    const result = await probeCdpAvailability(null, detect, probeLiveness);
    expect(result).toEqual({ available: true, browserName: "Google Chrome" });
  });

  it("reports unavailable when the liveness probe confirms no candidate is live", async () => {
    const detect = async (): Promise<DetectedBrowser[]> => [
      browser("Dia", 9222, 1),
      browser("Google Chrome", 9223, 0),
    ];
    const probeLiveness = async (): Promise<DetectedBrowser | undefined> => undefined;
    const result = await probeCdpAvailability(null, detect, probeLiveness);
    expect(result).toEqual({ available: false });
  });

  it("reports unavailable when no debug-enabled browser is detected", async () => {
    const result = await probeCdpAvailability(null, async () => [], async () => undefined);
    expect(result).toEqual({ available: false });
  });
});
