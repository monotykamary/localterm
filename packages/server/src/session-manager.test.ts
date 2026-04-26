import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionManager } from "./session-manager.js";

const REAL_FS_TIMEOUT_MS = 8000;

let tempDir: string;
let canonicalTempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "localterm-mgr-"));
  canonicalTempDir = realpathSync(tempDir);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const waitForPrompt = (millis: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, millis));

describe("SessionManager", () => {
  it(
    "inherits cwd from a source session via lsof/readlink",
    async () => {
      const manager = new SessionManager();
      try {
        const source = await manager.create({ shell: "/bin/sh", cwd: tempDir });
        await waitForPrompt(400);
        source.write(`cd "${tempDir}"\n`);
        await waitForPrompt(400);

        const inheritor = await manager.create({
          shell: "/bin/sh",
          inheritCwdFromSessionId: source.id,
        });
        const meta = inheritor.metadata();
        expect(realpathSync(meta.cwd)).toBe(canonicalTempDir);
      } finally {
        manager.disposeAll();
      }
    },
    REAL_FS_TIMEOUT_MS,
  );

  it("falls back to default cwd when source session is unknown", async () => {
    const manager = new SessionManager();
    try {
      const created = await manager.create({
        shell: "/bin/sh",
        inheritCwdFromSessionId: "does-not-exist",
      });
      const meta = created.metadata();
      expect(meta.cwd).toBe(os.homedir());
    } finally {
      manager.disposeAll();
    }
  });

  it("explicit cwd wins over inheritance", async () => {
    const manager = new SessionManager();
    try {
      const source = await manager.create({ shell: "/bin/sh", cwd: tempDir });
      const created = await manager.create({
        shell: "/bin/sh",
        cwd: os.homedir(),
        inheritCwdFromSessionId: source.id,
      });
      expect(created.metadata().cwd).toBe(os.homedir());
    } finally {
      manager.disposeAll();
    }
  });
});
