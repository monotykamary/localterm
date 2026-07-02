import { describe, expect, it } from "vite-plus/test";
import { capturePanePng, type SessionAutomationDeps } from "../src/session-automation.js";
import type { CdpClient } from "../src/cdp/cdp-client.js";
import type { SessionManager } from "../src/session-manager.js";
import type { SessionOwner } from "../src/identity/types.js";
import { LOCALTERM_PANE_TEXT_PROPERTY } from "../src/constants.js";

const PANE_TEXT = "$ ready";

interface RecordedCall {
  method: "setCookie" | "openBackgroundTab";
  arg?: unknown;
}

// A minimal CdpClient stub: records setCookie/openBackgroundTab in order and
// short-circuits the render-landed poll (evaluateInSession echoes the pane-text
// property back) so capturePanePng resolves without a real browser. The clip
// expr returns null (no `.xterm`) so the screenshot is full-frame.
const createMockCdp = (opts: { existing?: string } = {}): { client: CdpClient; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  const client = {
    findTargetByUrl: async () => opts.existing ?? null,
    openBackgroundTab: async (url: string) => {
      calls.push({ method: "openBackgroundTab", arg: url });
      return "target-1";
    },
    attachSession: async () => "session-1",
    setCookie: async (cookie: { name: string; value: string; url: string }) => {
      calls.push({ method: "setCookie", arg: cookie });
      return true;
    },
    evaluateInSession: async (_sid: string, expr: string) =>
      expr.includes(LOCALTERM_PANE_TEXT_PROPERTY) ? PANE_TEXT : null,
    captureScreenshotInSession: async () => Buffer.from("png"),
    closeTab: async () => {},
  };
  return { client: client as unknown as CdpClient, calls };
};

// capturePanePng only reads `capturePane` (via waitForRenderLanded); a one-
// method stub is enough and avoids spinning a real PTY.
const createMockRegistry = () =>
  ({ capturePane: async () => PANE_TEXT }) as unknown as SessionManager;

const mintViewerCookie = (owner: SessionOwner): { name: string; value: string } | null =>
  owner ? { name: "lt_session", value: `signed:${owner}` } : null;

const buildTabUrl = (id: string): string => `http://localhost:3417/ws?sid=${id}`;

describe("CDP viewer-tab cookie minting", () => {
  it("mints a session cookie for an ephemeral tab before opening it", async () => {
    const { client, calls } = createMockCdp();
    const png = await capturePanePng(
      { cdpClient: client, buildTabUrl, mintViewerCookie },
      createMockRegistry(),
      "s1",
      "alice",
    );
    expect(png).toBeInstanceOf(Buffer);
    const setCookie = calls.find((call) => call.method === "setCookie");
    const openTab = calls.find((call) => call.method === "openBackgroundTab");
    expect(setCookie).toBeDefined();
    expect(openTab).toBeDefined();
    expect(calls.indexOf(setCookie!)).toBeLessThan(calls.indexOf(openTab!));
    expect(setCookie!.arg).toEqual({
      name: "lt_session",
      value: "signed:alice",
      url: "http://localhost:3417/ws?sid=s1",
    });
  });

  it("does not mint a cookie for an existing live viewer tab (it already has one)", async () => {
    const { client, calls } = createMockCdp({ existing: "target-existing" });
    const png = await capturePanePng(
      { cdpClient: client, buildTabUrl, mintViewerCookie },
      createMockRegistry(),
      "s1",
      "alice",
    );
    expect(png).toBeInstanceOf(Buffer);
    expect(calls.find((call) => call.method === "setCookie")).toBeUndefined();
    expect(calls.find((call) => call.method === "openBackgroundTab")).toBeUndefined();
  });

  it("skips minting when no provider is configured (mintViewerCookie undefined)", async () => {
    const { client, calls } = createMockCdp();
    const png = await capturePanePng(
      { cdpClient: client, buildTabUrl },
      createMockRegistry(),
      "s1",
      "alice",
    );
    expect(png).toBeInstanceOf(Buffer);
    expect(calls.find((call) => call.method === "setCookie")).toBeUndefined();
    expect(calls.find((call) => call.method === "openBackgroundTab")).toBeDefined();
  });

  it("skips minting for the operator tier (mintViewerCookie returns null) and degrades", async () => {
    const { client, calls } = createMockCdp();
    const png = await capturePanePng(
      { cdpClient: client, buildTabUrl, mintViewerCookie },
      createMockRegistry(),
      "s1",
      null,
    );
    expect(png).toBeInstanceOf(Buffer);
    expect(calls.find((call) => call.method === "setCookie")).toBeUndefined();
    expect(calls.find((call) => call.method === "openBackgroundTab")).toBeDefined();
  });
});
