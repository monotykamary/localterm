import { describe, expect, it, vi } from "vite-plus/test";

const execFileMock = vi.fn();
const accessSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  // promisify(execFile) calls execFile(...args, callback); adopt that shape so the
  // promisified wrapper resolves.
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: unknown, result: unknown) => void;
    try {
      const result = execFileMock(...args.slice(0, -1));
      if (result instanceof Promise) {
        result.then(
          (value) => callback(null, value),
          (error) => callback(error, undefined),
        );
      } else {
        callback(null, result);
      }
    } catch (error) {
      callback(error, undefined);
    }
  },
}));
vi.mock("node:fs", async () => {
  const actual = await import("node:fs");
  return {
    ...actual,
    accessSync: (...args: unknown[]) => accessSyncMock(...args),
  };
});

const { configureTailscaleServe, resolveTailscaleRoute } =
  await import("../../src/utils/tailscale.js");

const serveConfigured = (port: number, dnsName: string) => (_binary: string, args: string[]) => {
  if (args[0] === "serve" && args[1] === "--bg") {
    return Promise.resolve({ stdout: "", stderr: "" });
  }
  if (args[0] === "serve" && args[1] === "status") {
    return Promise.resolve({
      stdout: JSON.stringify({
        Web: {
          [`${dnsName}:443`]: { Handlers: { "/": { Proxy: `http://localhost:${port}` } } },
        },
      }),
      stderr: "",
    });
  }
  if (args[0] === "status") {
    return Promise.resolve({
      stdout: JSON.stringify({ Self: { DNSName: `${dnsName}.`, Online: true } }),
      stderr: "",
    });
  }
  return Promise.reject(Object.assign(new Error("unexpected tailscale call"), { code: "ENOENT" }));
};

const withBinaryAvailable = () => accessSyncMock.mockImplementation(() => {});

const resetMocks = () => {
  execFileMock.mockReset();
  accessSyncMock.mockReset();
};

describe("tailscale integration", () => {
  it("strips the trailing dot from the DNS name", async () => {
    resetMocks();
    withBinaryAvailable();
    execFileMock.mockImplementation(serveConfigured(3417, "tom-macbook-air-m2.taild0936.ts.net"));
    const route = await resolveTailscaleRoute(3417);
    expect(route.url).toBe("https://tom-macbook-air-m2.taild0936.ts.net");
    expect(route.registered).toBe(true);
  });

  it("reports binary-missing when no tailscale binary is found", async () => {
    resetMocks();
    accessSyncMock.mockImplementation(() => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    });
    execFileMock.mockImplementation(() =>
      Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    );
    const route = await configureTailscaleServe(3417);
    expect(route.registered).toBe(false);
    expect(route.reason).toBe("binary-missing");
    expect(route.hint).toMatch(/tailscale\.com/);
  });

  it("reports https-disabled when tailscale rejects the cert provisioning", async () => {
    resetMocks();
    withBinaryAvailable();
    execFileMock.mockImplementation((_binary: string, args: string[]) => {
      if (args[0] === "serve" && args[1] === "--bg") {
        return Promise.reject(
          Object.assign(
            new Error("HTTPS cert support is not enabled/configured for your tailnet."),
            { code: 1 },
          ),
        );
      }
      return Promise.resolve({ stdout: "", stderr: "" });
    });
    const route = await configureTailscaleServe(3417);
    expect(route.registered).toBe(false);
    expect(route.reason).toBe("https-disabled");
    expect(route.hint).toMatch(/login\.tailscale\.com/);
  });

  it("returns serve-mismatch when the proxy targets a different port", async () => {
    resetMocks();
    withBinaryAvailable();
    const dnsName = "tom-macbook-air-m2.taild0936.ts.net";
    execFileMock.mockImplementation((_binary: string, args: string[]) => {
      if (args[0] === "serve" && args[1] === "status") {
        return Promise.resolve({
          stdout: JSON.stringify({
            Web: {
              [`${dnsName}:443`]: { Handlers: { "/": { Proxy: "http://localhost:9999" } } },
            },
          }),
          stderr: "",
        });
      }
      if (args[0] === "status") {
        return Promise.resolve({
          stdout: JSON.stringify({ Self: { DNSName: dnsName, Online: true } }),
          stderr: "",
        });
      }
      return Promise.resolve({ stdout: "", stderr: "" });
    });
    const route = await resolveTailscaleRoute(3417);
    expect(route.registered).toBe(false);
    expect(route.reason).toBe("serve-mismatch");
  });

  it("reports offline when the daemon responds but the node is offline", async () => {
    resetMocks();
    withBinaryAvailable();
    execFileMock.mockImplementation((_binary: string, args: string[]) => {
      if (args[0] === "serve" && args[1] === "--bg") {
        return Promise.resolve({ stdout: "", stderr: "" });
      }
      if (args[0] === "status") {
        return Promise.resolve({
          stdout: JSON.stringify({ Self: { DNSName: "x.ts.net", Online: false } }),
          stderr: "",
        });
      }
      return Promise.resolve({ stdout: "", stderr: "" });
    });
    const route = await configureTailscaleServe(3417);
    expect(route.registered).toBe(false);
    expect(route.reason).toBe("offline");
  });
});
