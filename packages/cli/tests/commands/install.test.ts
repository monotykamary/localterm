import { describe, expect, it } from "vite-plus/test";
import { buildPlistContent } from "../../src/commands/install.js";
import { LAUNCHD_LABEL } from "../../src/constants.js";

describe("buildPlistContent", () => {
  it("includes the launchd label", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
  });

  it("includes RunAtLoad and KeepAlive", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
  });

  it("includes the start command with port and host", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("<string>start</string>");
    expect(plist).toContain("<string>--port</string>");
    expect(plist).toContain("<string>3417</string>");
    expect(plist).toContain("<string>--host</string>");
    expect(plist).toContain("<string>127.0.0.1</string>");
  });

  it("includes the node exec path and CLI entry", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain(`<string>${process.execPath}</string>`);
  });

  it("includes HOME environment variable", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("<key>HOME</key>");
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
