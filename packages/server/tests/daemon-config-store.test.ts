import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { DaemonConfigStore } from "../src/daemon-config-store.js";
import { DAEMON_CONFIG_FILE_VERSION, SESSION_GRACE_DEFAULT_SECONDS } from "../src/constants.js";

describe("DaemonConfigStore", () => {
  let stateDirectory: string;
  let filePath: string;

  beforeEach(() => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-config-"));
    filePath = path.join(stateDirectory, "config.json");
  });

  afterEach(() => {
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("defaults to a null cdpPort (auto-detect) when no file exists", () => {
    const store = new DaemonConfigStore(filePath);
    expect(store.getCdpPort()).toBeNull();
  });

  it("persists and re-reads a configured port across instances", () => {
    const store = new DaemonConfigStore(filePath);
    expect(store.setCdpPort(52860)).toBe(52860);
    const reloaded = new DaemonConfigStore(filePath);
    expect(reloaded.getCdpPort()).toBe(52860);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({
      version: DAEMON_CONFIG_FILE_VERSION,
      cdpPort: 52860,
      graceSeconds: SESSION_GRACE_DEFAULT_SECONDS,
    });
  });

  it("clears the override back to null", () => {
    const store = new DaemonConfigStore(filePath);
    store.setCdpPort(52860);
    expect(store.setCdpPort(null)).toBeNull();
    expect(store.getCdpPort()).toBeNull();
  });

  it("rejects out-of-range ports as null without persisting garbage", () => {
    const store = new DaemonConfigStore(filePath);
    expect(store.setCdpPort(0)).toBeNull();
    expect(store.setCdpPort(70000)).toBeNull();
    expect(store.setCdpPort(1.5)).toBeNull();
    expect(store.getCdpPort()).toBeNull();
  });

  it("does not persist when the value is unchanged", () => {
    const store = new DaemonConfigStore(filePath);
    store.setCdpPort(9222);
    const mtimeBefore = fs.statSync(filePath).mtimeMs;
    expect(store.setCdpPort(9222)).toBe(9222);
    expect(fs.statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it("falls back to defaults on a corrupt file", () => {
    fs.mkdirSync(stateDirectory, { recursive: true });
    fs.writeFileSync(filePath, "{not valid json");
    const store = new DaemonConfigStore(filePath);
    expect(store.getCdpPort()).toBeNull();
  });

  it("falls back to defaults on a file missing the cdpPort field", () => {
    fs.writeFileSync(filePath, JSON.stringify({ version: DAEMON_CONFIG_FILE_VERSION }));
    const store = new DaemonConfigStore(filePath);
    expect(store.getCdpPort()).toBeNull();
  });
});
