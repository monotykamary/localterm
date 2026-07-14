import fs from "node:fs";
import os from "node:os";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { SessionManager } from "../src/session-manager.js";
import { pasteImageDirForSession, writePastedImage } from "../src/utils/paste-image-store.js";
import type { ClientSocket } from "../src/utils/ws-socket.js";

const createFakeSocket = (): ClientSocket => ({
  readyState: 1,
  send: () => {},
  close: () => {},
});

const createManager = (): SessionManager =>
  new SessionManager({
    getGraceMs: () => 1000,
    sendControl: () => {},
    hooks: {
      onOutputActivity: () => {},
      onSessionActivity: () => {},
      onSessionEvent: () => {},
      onAutomationExit: () => {},
      onClientExit: () => {},
    },
  });

describe("pasted image session lifecycle", { tags: ["integration"] }, () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("reaps a session's paste dir when the session is killed", () => {
    manager = createManager();
    const socket = createFakeSocket();
    const spawned = manager.spawnAndAttach(socket, { shell: "/bin/sh", cwd: os.tmpdir() });
    expect(spawned).not.toBeNull();
    if (!spawned) return;

    writePastedImage(spawned.id, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "png");
    const dir = pasteImageDirForSession(spawned.id);
    expect(fs.existsSync(dir)).toBe(true);

    expect(manager.kill(spawned.id)).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  }, 10_000);
});
