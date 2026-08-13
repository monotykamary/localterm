import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const describeOnMac = process.platform === "darwin" ? describe : describe.skip;
const TEST_BATCH_TIMEOUT_MS = 1_000;
const TEST_TERM_GRACE_MS = 80;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

describeOnMac("localterm-secret-helper", () => {
  let temporaryDirectory: string;
  let helperPath: string;

  beforeAll(() => {
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "localterm-secret-helper-"));
    const fixturePath = path.join(temporaryDirectory, "security-fixture");
    helperPath = path.join(temporaryDirectory, "localterm-secret-helper");
    const root = path.resolve(import.meta.dirname, "..");
    const fixtureCompile = spawnSync(
      "/usr/bin/clang",
      [path.join(import.meta.dirname, "fixtures/security-fixture.c"), "-o", fixturePath],
      { encoding: "utf8" },
    );
    expect(fixtureCompile.status, fixtureCompile.stderr).toBe(0);
    const helperCompile = spawnSync(
      "/usr/bin/clang",
      [
        "-Wall",
        "-Wextra",
        "-Werror",
        `-DLOCALTERM_SECURITY_PATH="${fixturePath}"`,
        `-DLOCALTERM_BATCH_TIMEOUT_MS=${TEST_BATCH_TIMEOUT_MS}`,
        `-DLOCALTERM_TERM_GRACE_MS=${TEST_TERM_GRACE_MS}`,
        "-DLOCALTERM_KILL_REAP_MS=100",
        path.join(root, "native/localterm-secret-helper.c"),
        "-o",
        helperPath,
      ],
      { encoding: "utf8" },
    );
    expect(helperCompile.status, helperCompile.stderr).toBe(0);
  });

  afterAll(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  const run = (mappings: string[], script: string, environment: NodeJS.ProcessEnv = {}) =>
    spawnSync(helperPath, [...mappings, "--", "/bin/sh", "-c", script], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", ...environment },
      timeout: 2_000,
    });

  const waitForFixturePid = async (pidFile: string): Promise<number> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (existsSync(pidFile)) return Number.parseInt(readFileSync(pidFile, "utf8"), 10);
      await delay(5);
    }
    throw new Error("synthetic security child did not record its pid");
  };

  const expectProcessGone = async (pid: number): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
        throw error;
      }
      await delay(5);
    }
    throw new Error(`synthetic security child ${pid} was not reaped`);
  };

  it("sets hits, preserves inherited values on misses, and rejects oversized or NUL values", () => {
    const result = run(
      ["FOUND", "alpha", "MISSED", "missing", "TOO_LARGE", "oversize", "HAS_NUL", "nul"],
      'printf \'%s|%s|%s|%s\' "$FOUND" "$MISSED" "$TOO_LARGE" "$HAS_NUL"',
      { MISSED: "inherited", TOO_LARGE: "inherited-large", HAS_NUL: "inherited-nul" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("synthetic-alpha|inherited|inherited-large|inherited-nul");
  });

  it("removes exactly one trailing LF and preserves the preceding CR", () => {
    const result = run(["VALUE", "cr"], 'printf %s "$VALUE"');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("synthetic-cr\r");
  });

  it("starts mapping lookups concurrently", () => {
    const mappings = Array.from({ length: 8 }, (_, index) => [
      `VALUE_${index}`,
      `slow${index}`,
    ]).flat();
    const startedAt = performance.now();
    const result = run(mappings, "printf done");
    const elapsedMs = performance.now() - startedAt;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("done");
    expect(elapsedMs).toBeLessThan(600);
  });

  it("times out a hung lookup and reaps it after TERM", async () => {
    const pidFile = path.join(temporaryDirectory, `hang-${Date.now()}.pid`);
    const startedAt = performance.now();
    const result = run(["VALUE", "hang"], "exit 0", { LOCALTERM_FIXTURE_PID_FILE: pidFile });
    const elapsedMs = performance.now() - startedAt;
    const fixturePid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
    expect(result.status).toBe(71);
    expect(elapsedMs).toBeGreaterThanOrEqual(TEST_BATCH_TIMEOUT_MS - 40);
    expect(elapsedMs).toBeLessThan(1_700);
    await expectProcessGone(fixturePid);
  });

  it("kills and reaps a TERM-ignoring lookup after bounded grace", async () => {
    const pidFile = path.join(temporaryDirectory, `ignoreterm-${Date.now()}.pid`);
    const startedAt = performance.now();
    const result = run(["VALUE", "ignoreterm"], "exit 0", {
      LOCALTERM_FIXTURE_PID_FILE: pidFile,
    });
    const elapsedMs = performance.now() - startedAt;
    const fixturePid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
    expect(result.status).toBe(71);
    expect(elapsedMs).toBeGreaterThanOrEqual(TEST_BATCH_TIMEOUT_MS + TEST_TERM_GRACE_MS - 50);
    expect(elapsedMs).toBeLessThan(1_900);
    await expectProcessGone(fixturePid);
  });

  it("interrupts a lookup on SIGINT and reaps its child", async () => {
    const pidFile = path.join(temporaryDirectory, `signal-${Date.now()}.pid`);
    const child = spawn(helperPath, ["VALUE", "ignoreterm", "--", "/bin/sh", "-c", "exit 0"], {
      env: { PATH: "/usr/bin:/bin", LOCALTERM_FIXTURE_PID_FILE: pidFile },
      stdio: "ignore",
    });
    const fixturePid = await waitForFixturePid(pidFile);
    const startedAt = performance.now();
    child.kill("SIGINT");
    const [status] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    expect(status).toBe(130);
    expect(performance.now() - startedAt).toBeLessThan(700);
    await expectProcessGone(fixturePid);
  });

  it("works when inherited standard descriptors start closed", () => {
    const outputPath = path.join(temporaryDirectory, `closed-stdio-${Date.now()}`);
    const wrapper =
      'exec 0<&- 1>&- 2>&-; exec "$1" CLOSED alpha -- /bin/sh -c \'printf %s "$CLOSED" > "$1"\' command "$2"';
    const result = spawnSync("/bin/sh", ["-c", wrapper, "wrapper", helperPath, outputPath], {
      timeout: 2_000,
    });
    expect(result.status).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toBe("synthetic-alpha");
  });

  it("rejects invalid mappings and more than 32 mappings", () => {
    expect(run(["lowercase", "alpha"], "exit 0").status).toBe(64);
    const tooMany = Array.from({ length: 33 }, (_, index) => [
      `VALUE_${index}`,
      `name${index}`,
    ]).flat();
    expect(run(tooMany, "exit 0").status).toBe(64);
  });
});
