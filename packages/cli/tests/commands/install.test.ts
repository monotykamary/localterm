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

  it("invokes the daemon through a login shell", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("<string>-l</string>");
    expect(plist).toContain("<string>-c</string>");
    expect(plist).toContain("--port 3417");
    expect(plist).toContain("--host 127.0.0.1");
  });

  it("includes the node exec path in the daemon command", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain(process.execPath);
  });

  it("includes HOME environment variable", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("<key>HOME</key>");
  });

  it("does not include a static PATH in EnvironmentVariables", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).not.toContain("<key>PATH</key>");
  });

  it("uses custom port and host when specified", () => {
    const plist = buildPlistContent({ port: 9999, host: "0.0.0.0" });
    expect(plist).toContain("--port 9999");
    expect(plist).toContain("--host 0.0.0.0");
  });

  it("uses the server.log path for stdout and stderr", () => {
    const plist = buildPlistContent({ port: 3417, host: "127.0.0.1" });
    expect(plist).toContain("server.log");
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("<key>StandardErrorPath</key>");
  });
});
