import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type RunningServer } from "../src/index.js";
import { CdpClient } from "../src/cdp/cdp-client.js";
import type { DetectedBrowser } from "../src/cdp/detect-chromium.js";
import { signSessionToken } from "../src/identity/session-cookie.js";
import { AUTH_COOKIE_NAME, AUTH_SECRET_FILENAME } from "../src/constants.js";
import type { SecretBackend } from "../src/secret-backend.js";

// The browser-only SSO paths driven over raw CDP against a throwaway headless
// Chrome (the system's binary — no Playwright, no download). Gated behind
// LOCALTERM_E2E_BROWSER=1 (and a present Chrome) so a normal `pnpm test` never
// spawns a browser; run with `LOCALTERM_E2E_BROWSER=1 npx vp test --run
// tests/e2e-sso-browser.test.ts`. The headless Chrome + the in-process daemon
// are fully isolated (own user-data dir, own state dir, random port) and never
// touch the localterm we're running in.
//
// Two flows: (1) the passkey WebAuthn ceremony end-to-end via a CDP virtual
// authenticator (register → session → terminal mounts), and (2) capture-pane
// --png in auth-gated mode — the daemon's CDP cookie mint against a real
// browser (setCookie → tab → /ws attaches through the gate → xterm → PNG).

const CHROME_CANDIDATES = [
  process.env.LOCALTERM_CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "/usr/bin/brave-browser",
].filter((candidate): candidate is string => Boolean(candidate) && existsSync(candidate));

const CHROME_BIN = CHROME_CANDIDATES[0] ?? null;
const ENABLED = process.env.LOCALTERM_E2E_BROWSER === "1" && CHROME_BIN !== null;
const d = ENABLED ? describe : describe.skip;

// The built terminal app the daemon serves at `/` (the auth gate + terminal).
const TERMINAL_DIST = fileURLToPath(new URL("../../../apps/terminal/dist", import.meta.url));

class InMemorySecretBackend implements SecretBackend {
  readonly supported = true;
  readonly store = new Map<string, string>();
  async get(name: string) {
    return this.store.get(name) ?? null;
  }
  async has(name: string) {
    return this.store.has(name);
  }
  async set(name: string, value: string) {
    this.store.set(name, value);
  }
  async delete(name: string) {
    this.store.delete(name);
  }
  shimResolveSnippet(name: string, envVar: string): string {
    return `_test_resolve '${name}' ${envVar}`;
  }
}

interface HeadlessChrome {
  detected: DetectedBrowser;
  stop: () => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const launchHeadlessChrome = async (binary: string, dataDir: string): Promise<HeadlessChrome> => {
  const child = spawn(
    binary,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${dataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-extensions",
      "--password-store=basic",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const stderrChunks: Buffer[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const portFile = path.join(dataDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const [portStr, wsPath] = readFileSync(portFile, "utf8").trim().split("\n");
      const port = Number(portStr);
      if (Number.isFinite(port) && wsPath?.startsWith("/devtools/")) {
        const stop = async (): Promise<void> => {
          if (!child.killed) {
            child.kill("SIGTERM");
            await new Promise<void>((resolveKill) => {
              const force = setTimeout(() => {
                if (!child.killed) child.kill("SIGKILL");
                resolveKill();
              }, 3000);
              child.once("exit", () => {
                clearTimeout(force);
                resolveKill();
              });
            });
          }
        };
        return {
          detected: {
            name: "Headless Chrome",
            profileDir: dataDir,
            port,
            wsPath,
            wsUrl: `ws://127.0.0.1:${port}${wsPath}`,
            mtimeMs: Date.now(),
          },
          stop,
        };
      }
    } catch {
      /* DevToolsActivePort not written yet */
    }
    await sleep(100);
  }
  child.kill("SIGKILL");
  throw new Error(
    `headless Chrome did not expose a CDP port: ${Buffer.concat(stderrChunks).toString().slice(0, 500)}`,
  );
};

const pollFor = async (
  fn: () => Promise<boolean>,
  attempts = 300,
  intervalMs = 50,
): Promise<boolean> => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
};

const evalIn = (cdp: CdpClient, sessionId: string, expression: string): Promise<unknown> =>
  cdp.evaluateInSession(sessionId, expression);

d("e2e: passkey WebAuthn + CDP cookie mint (headless Chrome)", () => {
  let chrome: HeadlessChrome;
  let server: RunningServer;
  let daemonOrigin: string;
  let driver: CdpClient;
  let stateDirectory: string;
  let chromeDataDir: string;

  beforeEach(async () => {
    stateDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-e2e-browser-"));
    chromeDataDir = mkdtempSync(path.join(os.tmpdir(), "localterm-headless-"));
    chrome = await launchHeadlessChrome(CHROME_BIN!, chromeDataDir);
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      secretBackend: new InMemorySecretBackend(),
      cdpDetect: async () => [chrome.detected],
      staticRoot: TERMINAL_DIST,
      identity: { provider: "passkey", registration: "open", operatorToken: "op-token" },
    });
    daemonOrigin = `http://localhost:${server.port}`;
    server.setPublicUrl(daemonOrigin);
    driver = new CdpClient({ detect: async () => [chrome.detected] });
    await driver.connect();
  });

  afterEach(async () => {
    try {
      await driver.close();
    } catch {
      /* already closed */
    }
    await server.stop();
    await chrome.stop();
    rmSync(stateDirectory, { recursive: true, force: true });
    rmSync(chromeDataDir, { recursive: true, force: true });
  });

  it("registers a passkey and signs in via a CDP virtual authenticator", async () => {
    const targetId = await driver.openForegroundTab(`${daemonOrigin}/`);
    expect(targetId).toBeTruthy();
    const sessionId = await driver.attachSession(targetId!);
    expect(sessionId).toBeTruthy();
    const authenticatorId = await driver.addVirtualAuthenticator(sessionId!);
    expect(authenticatorId).toBeTruthy();
    try {
      // The auth gate's probe runs → passkey login screen (the username input).
      const inputReady = await pollFor(async () =>
        Boolean(
          await evalIn(
            driver,
            sessionId!,
            `document.querySelector("input[placeholder='username']") !== null`,
          ),
        ),
      );
      expect(inputReady).toBe(true);

      // Wrap navigator.credentials.create so the gate's startRegistration (which
      // converts the daemon's base64url options to ArrayBuffers) drives the real
      // ceremony; capture the result as a diagnostic if the terminal never mounts.
      await evalIn(
        driver,
        sessionId!,
        `(() => {
        window.__e2e = null;
        const orig = navigator.credentials.create.bind(navigator.credentials);
        navigator.credentials.create = async (args) => {
          try { const r = await orig(args); window.__e2e = "OK"; return r; }
          catch (e) { window.__e2e = "ERR " + (e?.name ?? "") + ": " + (e?.message ?? String(e)); throw e; }
        };
      })()`,
      );
      // Fill the username (React-controlled: the native value setter + input event).
      await evalIn(
        driver,
        sessionId!,
        `(() => {
        const el = document.querySelector("input[placeholder='username']");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(el, "alice");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      })()`,
      );
      // Click "Register a passkey" → startRegistration → navigator.credentials.create
      // (auto-resolves against the virtual authenticator) → /verify → session
      // cookie → the gate re-checks → the terminal mounts.
      await evalIn(
        driver,
        sessionId!,
        `(() => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Register a passkey"));
        btn?.click();
      })()`,
      );
      const terminalMounted = await pollFor(async () =>
        Boolean(await evalIn(driver, sessionId!, `document.querySelector(".xterm") !== null`)),
      );
      if (!terminalMounted) {
        const createResult = await evalIn(driver, sessionId!, `window.__e2e`);
        const gateError = await evalIn(
          driver,
          sessionId!,
          `document.querySelector(".text-destructive")?.textContent ?? null`,
        );
        throw new Error(
          `terminal did not mount — credentials.create=${createResult} gateError=${gateError}`,
        );
      }
      expect(terminalMounted).toBe(true);

      await driver.closeTab(targetId!);
    } finally {
      await driver.removeVirtualAuthenticator(sessionId!, authenticatorId!);
    }
  }, 30000);

  it("capture-pane --png works in auth-gated mode (the CDP cookie mint, real browser)", async () => {
    const secret = readFileSync(path.join(stateDirectory, AUTH_SECRET_FILENAME), "utf8");
    const aliceCookie = `${AUTH_COOKIE_NAME}=${signSessionToken(secret, "alice")}`;

    const created = await fetch(`${daemonOrigin}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: aliceCookie },
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: { id: string } };

    // The daemon opens a CDP tab in the headless Chrome, mints it alice's
    // session cookie (Network.setCookie) so its /ws passes the gate, waits for
    // xterm to render, and screenshots. A PNG back is the end-to-end proof.
    const pngRes = await fetch(`${daemonOrigin}/api/sessions/${session.id}/pane?format=png`, {
      headers: { cookie: aliceCookie },
    });
    expect(pngRes.status).toBe(200);
    expect(pngRes.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await pngRes.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }, 30000);
});
