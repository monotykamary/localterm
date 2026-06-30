import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { DetectedBrowser } from "../src/cdp/detect-chromium.js";
import {
  detectWithExplicitPort,
  discoverExplicitCdpEndpoint,
} from "../src/cdp/discover-explicit-endpoint.js";

const asideBrowser = (port = 52860): DetectedBrowser => ({
  name: "Aside",
  profileDir: "/home/me/Library/Application Support/Aside",
  port,
  wsPath: `/devtools/browser/aside-${port}`,
  wsUrl: `ws://127.0.0.1:${port}/devtools/browser/aside-${port}`,
  mtimeMs: 1,
});

const chromeBrowser = (port = 9222): DetectedBrowser => ({
  name: "Google Chrome",
  profileDir: "/home/me/Library/Application Support/Google/Chrome",
  port,
  wsPath: `/devtools/browser/chrome-${port}`,
  wsUrl: `ws://127.0.0.1:${port}/devtools/browser/chrome-${port}`,
  mtimeMs: 2,
});

const stubFetchFailing = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const stubFetchOk = (wsUrl: string): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ Browser: "Aside/1.0", webSocketDebuggerUrl: wsUrl }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("discoverExplicitCdpEndpoint", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the /json/version webSocketDebuggerUrl when served", async () => {
    stubFetchOk("ws://127.0.0.1:52860/devtools/browser/from-http");
    const result = await discoverExplicitCdpEndpoint(52860, [asideBrowser()]);
    expect(result?.wsUrl).toBe("ws://127.0.0.1:52860/devtools/browser/from-http");
    expect(result?.port).toBe(52860);
  });

  it("falls back to a DevToolsActivePort file matching the port when /json/version is unavailable", async () => {
    stubFetchFailing();
    const aside = asideBrowser();
    const result = await discoverExplicitCdpEndpoint(52860, [aside, chromeBrowser()]);
    // Aside exposes CDP on 52860 without serving /json/version (like Chrome
    // 144+ / Dia), so discovery must resolve it from the file scan.
    expect(result).toBe(aside);
  });

  it("returns undefined when no detected browser matches the port", async () => {
    stubFetchFailing();
    const result = await discoverExplicitCdpEndpoint(52860, [chromeBrowser()]);
    expect(result).toBeUndefined();
  });
});

describe("detectWithExplicitPort", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prepends the explicit-port browser and dedups the file scan", async () => {
    stubFetchFailing();
    const aside = asideBrowser();
    const chrome = chromeBrowser();
    const detected = await detectWithExplicitPort(52860, async () => [chrome, aside]);
    // Aside matches the configured port → first; Chrome kept as fallback, the
    // duplicate Aside entry dropped so establish() probes it once.
    expect(detected.map((browser) => browser.name)).toEqual(["Aside", "Google Chrome"]);
  });

  it("returns the file scan unchanged when no explicit port is configured", async () => {
    const chrome = chromeBrowser();
    const detected = await detectWithExplicitPort(null, async () => [chrome]);
    expect(detected).toEqual([chrome]);
  });

  it("returns the file scan unchanged when the explicit port resolves to nothing", async () => {
    stubFetchFailing();
    const chrome = chromeBrowser();
    const detected = await detectWithExplicitPort(52860, async () => [chrome]);
    // Chrome is on 9222, not 52860 → no explicit candidate; file scan as-is.
    expect(detected).toEqual([chrome]);
  });
});
