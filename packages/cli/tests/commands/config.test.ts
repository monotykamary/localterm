import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { daemonConfigFileSchema } from "@monotykamary/localterm-server/protocol";
import { runConfigIdentity } from "../../src/commands/config.js";

// `runConfigIdentity` writes `~/.localterm/config.json` via getStateDirectory →
// os.homedir. Point homedir at a fresh temp dir per test so the suite never
// touches the operator's real config.
let tmpHome = "";
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-cli-config-"));
  vi.spyOn(os, "homedir").mockImplementation(() => tmpHome);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  process.exitCode = 0;
});

afterEach(() => {
  logSpy.mockRestore();
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const configPath = () => path.join(tmpHome, ".localterm", "config.json");
const readConfig = () => daemonConfigFileSchema.parse(JSON.parse(fs.readFileSync(configPath(), "utf8")));

describe("localterm config identity", () => {
  it("writes a passkey identity block (optional fields dropped)", async () => {
    await runConfigIdentity("passkey", { registration: "open" });
    expect(readConfig().identity).toEqual({ provider: "passkey", registration: "open" });
  });

  it("writes a header identity block with options", async () => {
    await runConfigIdentity("header", { header: "X-User", trustedProxy: "10.0.0.0/8" });
    expect(readConfig().identity).toEqual({
      provider: "header",
      header: "X-User",
      trustedProxy: "10.0.0.0/8",
    });
  });

  it("writes an oidc identity block", async () => {
    await runConfigIdentity("oidc", {
      issuer: "https://accounts.example.com",
      clientId: "localterm",
      clientSecret: "secret",
    });
    expect(readConfig().identity).toEqual({
      provider: "oidc",
      issuer: "https://accounts.example.com",
      clientId: "localterm",
      clientSecret: "secret",
    });
  });

  it("clears the identity with 'none'", async () => {
    await runConfigIdentity("passkey", {});
    await runConfigIdentity("none", {});
    expect(readConfig().identity).toBeUndefined();
  });

  it("preserves existing cdpPort/graceSeconds across the change", async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ version: 1, cdpPort: 9222, graceSeconds: 45 }), "utf8");
    await runConfigIdentity("header", {});
    const config = readConfig();
    expect(config.cdpPort).toBe(9222);
    expect(config.graceSeconds).toBe(45);
    expect(config.identity?.provider).toBe("header");
  });

  it("fails on a bad oidc issuer URL without writing", async () => {
    const existed = fs.existsSync(configPath());
    await runConfigIdentity("oidc", { issuer: "not-a-url", clientId: "c" });
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(configPath())).toBe(existed);
    expect(logSpy.mock.calls.some((call: unknown[]) => /invalid identity config/.test(String(call[0])))).toBe(true);
  });

  it("fails on a missing oidc --issuer", async () => {
    await runConfigIdentity("oidc", {});
    expect(process.exitCode).toBe(1);
    expect(logSpy.mock.calls.some((call: unknown[]) => /--issuer is required/.test(String(call[0])))).toBe(true);
  });
});
