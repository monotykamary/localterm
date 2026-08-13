import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { SecretBackend } from "@monotykamary/localterm-server/secret-backend";
import { trySecretGetFastPath } from "../src/secret-get-fast-path.js";

const backend = (value: string | null): SecretBackend => ({
  supported: true,
  get: vi.fn(async () => value),
  has: async () => value !== null,
  set: async () => {},
  delete: async () => {},
  shimResolveSnippet: () => ":",
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("secret get launcher fast path", () => {
  it("prints a synthetic value with the command's existing stdout semantics", async () => {
    const fakeBackend = backend("synthetic-value");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      trySecretGetFastPath(["secret", "get", "synthetic-name"], fakeBackend),
    ).resolves.toBe(true);
    expect(fakeBackend.get).toHaveBeenCalledWith("synthetic-name");
    expect(write).toHaveBeenCalledWith("synthetic-value\n");
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    ["secret", "get"],
    ["secret", "get", "valid", "extra"],
    ["secret", "get", "--help"],
    ["secret", "get", "bad.name"],
    ["--help"],
  ])("falls through for non-exact shape %j", async (...arguments_) => {
    const fakeBackend = backend("unused");
    await expect(trySecretGetFastPath(arguments_, fakeBackend)).resolves.toBe(false);
    expect(fakeBackend.get).not.toHaveBeenCalled();
  });

  it("preserves the missing-secret exit and output behavior", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(trySecretGetFastPath(["secret", "get", "missing"], backend(null))).resolves.toBe(
      true,
    );
    expect(process.exitCode).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("no secret named 'missing'"));
  });
});
