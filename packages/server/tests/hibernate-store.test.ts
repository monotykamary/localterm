import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { HIBERNATE_FILE_VERSION } from "../src/constants.js";
import { HibernateStore, type HibernateEntry } from "../src/hibernate-store.js";

describe("HibernateStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-hibernate-"));
    filePath = path.join(dir, "hibernate.json");
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("round-trips rendered tab snapshots", () => {
    const entries: HibernateEntry[] = [
      {
        owner: null,
        windowId: "desktop",
        tabs: [
          {
            sessionId: "old-session",
            cwd: "/project",
            shell: "/bin/zsh",
            scrollback: "first\r\n$ ",
          },
        ],
      },
    ];
    const store = new HibernateStore(filePath);
    store.write(entries);

    expect(store.read()).toEqual(entries);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({
      version: HIBERNATE_FILE_VERSION,
      entries,
    });
  });

  it("returns an empty snapshot for missing, corrupt, or invalid files", () => {
    const store = new HibernateStore(filePath);
    expect(store.read()).toEqual([]);
    fs.writeFileSync(filePath, "not json");
    expect(store.read()).toEqual([]);
    fs.writeFileSync(filePath, JSON.stringify({ version: 999, entries: [] }));
    expect(store.read()).toEqual([]);
  });
});
