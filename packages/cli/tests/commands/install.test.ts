import { describe, expect, it } from "vite-plus/test";
import path from "node:path";
import { buildPlistContent, buildSystemdUnitContent } from "../../src/commands/install.js";
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

describe("buildSystemdUnitContent", () => {
  const baseInput = {
    port: 3417,
    host: "127.0.0.1",
    execPath: "/usr/local/bin/node",
    cliEntry: "/usr/local/lib/node_modules/@monotykamary/localterm/dist/index.js",
    tailscaleBootWaitSeconds: 30,
  };

  it("runs the daemon in the foreground with the resolved port and host", () => {
    const unit = buildSystemdUnitContent(baseInput);
    expect(unit).toContain("ExecStart=/usr/local/bin/node");
    expect(unit).toContain(
      "/usr/local/lib/node_modules/@monotykamary/localterm/dist/index.js start --foreground --port 3417 --host 127.0.0.1",
    );
    expect(unit).not.toContain("--open");
  });

  it("enables crash-only restart and the user-session default target", () => {
    const unit = buildSystemdUnitContent(baseInput);
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");
  });

  it("orders after network and tailscaled so the daemon can resolve the tailnet URL", () => {
    const unit = buildSystemdUnitContent(baseInput);
    expect(unit).toContain("After=network-online.target tailscaled.service");
    expect(unit).toContain("Wants=network-online.target");
  });

  it("bakes HOME and a PATH that includes the node dir and system bins", () => {
    const unit = buildSystemdUnitContent(baseInput);
    expect(unit).toContain("Environment=HOME=%h");
    expect(unit).toContain("Environment=PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    expect(unit).toContain(path.dirname(baseInput.execPath));
  });

  it("only waits for tailscale when it is installed (command -v guard in ExecStartPre)", () => {
    const unit = buildSystemdUnitContent(baseInput);
    expect(unit).toContain(
      "ExecStartPre=/bin/sh -c 'command -v tailscale >/dev/null 2>&1 || exit 0;",
    );
    expect(unit).toContain("for i in $(seq 1 30)");
    expect(unit).toMatch(/sleep 1; done; exit 0'/);
  });

  it("uses custom port and host when specified", () => {
    const unit = buildSystemdUnitContent({ ...baseInput, port: 9999, host: "0.0.0.0" });
    expect(unit).toContain("--port 9999");
    expect(unit).toContain("--host 0.0.0.0");
  });
});
