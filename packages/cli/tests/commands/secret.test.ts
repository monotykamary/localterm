import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The export/import commands are thin HTTP clients over the daemon's routes.
// Mock the daemon-api surface so the suite never touches a socket and the
// fetch payload/exit paths are asserted directly.
const daemonFetchMock = vi.fn();
const reportApiErrorMock = vi.fn();
const reportDaemonDownMock = vi.fn();

vi.mock("../../src/utils/daemon-api.js", () => ({
  daemonBaseUrl: () => "http://127.0.0.1:3417/api",
  daemonFetch: (...args: unknown[]) => daemonFetchMock(...args),
  reportApiError: (...args: unknown[]) => reportApiErrorMock(...args),
  reportDaemonDown: (...args: unknown[]) => reportDaemonDownMock(...args),
}));

const { runSecretExport, runSecretImport } = await import("../../src/commands/secret.js");

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-cli-secret-"));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  daemonFetchMock.mockReset();
  reportApiErrorMock.mockReset();
  reportDaemonDownMock.mockReset();
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("runSecretExport", () => {
  it("posts the passphrase and writes the armored ciphertext to a file", async () => {
    daemonFetchMock.mockResolvedValue(
      jsonResponse({
        data: "-----BEGIN AGE ENCRYPTED FILE-----\nABC\n-----END AGE ENCRYPTED FILE-----",
        count: 2,
        skipped: 1,
      }),
    );
    const output = path.join(tmpDir, "out.age");
    await runSecretExport({ passphrase: "pw", output });

    expect(daemonFetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3417/api/secrets/export",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ passphrase: "pw" }),
      }),
    );
    const written = fs.readFileSync(output, "utf8");
    expect(written).toContain("-----BEGIN AGE ENCRYPTED FILE-----");
    expect(written.endsWith("\n")).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("exported 2 secrets"),
      expect.anything(),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("1 skipped (no value set)"));
  });

  it("writes the ciphertext to stdout when output is '-'", async () => {
    daemonFetchMock.mockResolvedValue(jsonResponse({ data: "ARMORED", count: 0, skipped: 0 }));
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runSecretExport({ passphrase: "pw", output: "-" });
    expect(stdoutSpy).toHaveBeenCalledWith("ARMORED");
    stdoutSpy.mockRestore();
  });

  it("reports a daemon error and sets exitCode on a non-ok response", async () => {
    daemonFetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => '{"error":"unsupported"}',
    });
    await runSecretExport({ passphrase: "pw", output: path.join(tmpDir, "x.age") });
    expect(reportApiErrorMock).toHaveBeenCalledWith(409, expect.any(String));
    expect(process.exitCode).toBe(1);
  });
});

describe("runSecretImport", () => {
  it("posts the file contents + passphrase and logs the summary", async () => {
    const input = path.join(tmpDir, "in.age");
    fs.writeFileSync(input, "ARMORED-CONTENT", "utf8");
    daemonFetchMock.mockResolvedValue(
      jsonResponse({ imported: 2, created: 1, updated: 1, errors: [] }),
    );
    await runSecretImport({ passphrase: "pw", input });

    expect(daemonFetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3417/api/secrets/import",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ passphrase: "pw", data: "ARMORED-CONTENT" }),
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("imported 2 secrets"),
      expect.anything(),
    );
  });

  it("rejects reading both the file and the passphrase from stdin", async () => {
    await runSecretImport({ input: "-", passphrase: "-" });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("can't read both"));
    expect(process.exitCode).toBe(1);
    expect(daemonFetchMock).not.toHaveBeenCalled();
  });

  it("prints a friendly message on a 400 (wrong passphrase)", async () => {
    const input = path.join(tmpDir, "in.age");
    fs.writeFileSync(input, "X", "utf8");
    daemonFetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => "" });
    await runSecretImport({ passphrase: "pw", input });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("wrong passphrase"));
    expect(process.exitCode).toBe(1);
  });

  it("reports a missing file before contacting the daemon", async () => {
    await runSecretImport({ passphrase: "pw", input: path.join(tmpDir, "missing.age") });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("couldn't read"));
    expect(process.exitCode).toBe(1);
    expect(daemonFetchMock).not.toHaveBeenCalled();
  });
});
