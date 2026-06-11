import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { probeServerHealth } from "../../src/utils/probe-server-health";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probeServerHealth", () => {
  it("returns true when the health endpoint responds with ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await probeServerHealth()).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/health");
  });

  it("returns false when the server responds with a non-200 status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    expect(await probeServerHealth()).toBe(false);
  });

  it("returns false when fetch throws (network error / server down)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await probeServerHealth()).toBe(false);
  });
});
