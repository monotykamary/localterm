import { describe, expect, it } from "vite-plus/test";
import { buildDaemonStartArgs } from "../../src/utils/build-daemon-args.js";

describe("buildDaemonStartArgs", () => {
  it("includes the start subcommand, port, and host", () => {
    expect(buildDaemonStartArgs({ port: 3417, host: "127.0.0.1", open: false })).toEqual([
      "start",
      "--port",
      "3417",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("appends --open when the user wants to open the browser", () => {
    expect(buildDaemonStartArgs({ port: 8080, host: "localhost", open: true })).toEqual([
      "start",
      "--port",
      "8080",
      "--host",
      "localhost",
      "--open",
    ]);
  });

  it("renders non-default ports as strings", () => {
    expect(buildDaemonStartArgs({ port: 0, host: "127.0.0.1", open: false })).toContain("0");
  });
});
