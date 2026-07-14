import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";
import { FILE_PREVIEW_MAX_BYTES } from "../src/constants.js";

describe("/api/file/content text route", () => {
  let server: RunningServer;
  let cwd: string;

  beforeAll(async () => {
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      tabController: { open: async () => null, close: async () => {} },
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-content-"));
    fs.writeFileSync(path.join(cwd, "notes.txt"), "just text\n");
    fs.mkdirSync(path.join(cwd, "nested"));
    fs.writeFileSync(path.join(cwd, "nested", "code.ts"), "export const answer = 42;\n");
    fs.writeFileSync(path.join(cwd, "empty.name"), "Dockerfile-style content");
    fs.writeFileSync(path.join(cwd, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const contentUrl = (params: Record<string, string>): string => {
    const url = new URL(`http://127.0.0.1:${server.port}/api/file/content`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  };

  it("serves a text file as utf-8 text/plain", async () => {
    const response = await fetch(contentUrl({ cwd, path: "notes.txt" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("just text\n");
  });

  it("serves a nested source file", async () => {
    const response = await fetch(contentUrl({ cwd, path: "nested/code.ts" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("answer");
  });

  it("serves an extensionless text file", async () => {
    const response = await fetch(contentUrl({ cwd, path: "empty.name" }));
    expect(response.status).toBe(200);
  });

  it("carries a script-blocking CSP and no-store cache header", async () => {
    const response = await fetch(contentUrl({ cwd, path: "notes.txt" }));
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe("inline");
  });

  it("refuses a binary file with 415", async () => {
    const response = await fetch(contentUrl({ cwd, path: "binary.bin" }));
    expect(response.status).toBe(415);
  });

  it("refuses a file over the byte cap with 413", async () => {
    fs.writeFileSync(path.join(cwd, "huge.txt"), "x".repeat(FILE_PREVIEW_MAX_BYTES + 1));
    const response = await fetch(contentUrl({ cwd, path: "huge.txt" }));
    expect(response.status).toBe(413);
  });

  it("returns 404 for a missing file", async () => {
    const response = await fetch(contentUrl({ cwd, path: "missing.txt" }));
    expect(response.status).toBe(404);
  });

  it("returns 404 for a directory", async () => {
    const response = await fetch(contentUrl({ cwd, path: "nested" }));
    expect(response.status).toBe(404);
  });

  it("rejects a path traversal attempt", async () => {
    const response = await fetch(contentUrl({ cwd, path: "../notes.txt" }));
    expect(response.status).toBe(400);
  });

  it("rejects an absolute path", async () => {
    const response = await fetch(contentUrl({ cwd, path: "/etc/passwd" }));
    expect(response.status).toBe(400);
  });

  it("rejects a missing cwd", async () => {
    const response = await fetch(contentUrl({ path: "notes.txt" }));
    expect(response.status).toBe(400);
  });
});
