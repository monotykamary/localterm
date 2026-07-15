import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { WORKSPACE_FILE_VERSION } from "../src/constants.js";
import { WorkspaceStore } from "../src/workspace-store.js";

describe("WorkspaceStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-workspace-"));
    filePath = path.join(dir, "workspace.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads an empty manifest when no file exists", () => {
    expect(new WorkspaceStore(filePath).read()).toEqual([]);
  });

  it("round-trips entries and scopes them per owner + windowId", () => {
    const store = new WorkspaceStore(filePath);
    const entries = [
      {
        owner: null,
        windowId: "desktop-profile",
        tabs: [
          { cwd: "/home/proj", shell: "/bin/zsh" },
          { cwd: "/etc", shell: "/bin/bash" },
        ],
        savedAt: 1_000,
      },
      {
        owner: "alice",
        windowId: "phone-profile",
        tabs: [{ cwd: "/home/alice", shell: "/bin/fish" }],
        savedAt: 2_000,
      },
    ];
    store.write(entries);
    expect(new WorkspaceStore(filePath).read()).toEqual(entries);
  });

  it("returns the persisted file version and entries shape", () => {
    const store = new WorkspaceStore(filePath);
    store.write([{ owner: null, windowId: "w", tabs: [], savedAt: 0 }]);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(parsed).toEqual({
      version: WORKSPACE_FILE_VERSION,
      entries: [{ owner: null, windowId: "w", tabs: [], savedAt: 0 }],
    });
  });

  it("treats a corrupt file as an empty manifest", () => {
    fs.writeFileSync(filePath, "{ not json");
    expect(new WorkspaceStore(filePath).read()).toEqual([]);
  });

  it("treats a schema-invalid file as an empty manifest", () => {
    fs.writeFileSync(filePath, JSON.stringify({ version: 999, entries: [] }));
    expect(new WorkspaceStore(filePath).read()).toEqual([]);
  });
});
