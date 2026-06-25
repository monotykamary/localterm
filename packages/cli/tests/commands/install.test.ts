import { describe, expect, it } from "vite-plus/test";
import path from "node:path";
import { buildPlistContent } from "../../src/commands/install.js";
import { DAEMON_BASE_PATH, LAUNCHD_LABEL } from "../../src/constants.js";

describe("buildPlistContent", () => {
  it("includes the launchd label", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
  });

  it("includes RunAtLoad and crash-only KeepAlive", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<key>SuccessfulExit</key>");
    expect(plist).toContain("<false/>");
  });

  it("runs the daemon in the foreground", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("<string>start</string>");
    expect(plist).toContain("<string>--port</string>");
    expect(plist).toContain("<string>3417</string>");
    expect(plist).toContain("<string>--host</string>");
    expect(plist).toContain("<string>127.0.0.1</string>");
    expect(plist).toContain("<string>--foreground</string>");
    expect(plist).not.toContain("<string>-l</string>");
    expect(plist).not.toContain("<string>-c</string>");
  });

  it("includes the node exec path in the daemon command", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain(process.execPath);
  });

  it("includes HOME environment variable", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("<key>HOME</key>");
  });

  it("includes the minimal daemon PATH in EnvironmentVariables", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("<key>PATH</key>");
    expect(plist).toContain(DAEMON_BASE_PATH);
    expect(plist).toContain(path.dirname(process.execPath));
  });

  it("appends the portless directory to the daemon PATH when provided", () => {
    const plist = buildPlistContent({
      port: 3417,
      host: "127.0.0.1",
      portlessDir: "/Users/x/.npm-global/bin",
    });
    expect(plist).toContain(
      `<string>${DAEMON_BASE_PATH}:${path.dirname(process.execPath)}:/Users/x/.npm-global/bin</string>`,
    );
  });

  it("uses custom port and host when specified", () => {
    const plist = buildPlistContent({ port: 9999, host: "0.0.0.0" });
    expect(plist).toContain("<string>9999</string>");
    expect(plist).toContain("<string>0.0.0.0</string>");
  });

  it("uses the server.log path for stdout and stderr", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("server.log");
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("<key>StandardErrorPath</key>");
  });
});
