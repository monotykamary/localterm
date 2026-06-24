import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x45, 0x4e, 0x44,
]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const TEXT_BYTES = Buffer.from("just text");

describe("/api/file image route", () => {
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
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-file-"));
    fs.writeFileSync(path.join(cwd, "pic.png"), PNG_BYTES);
    fs.writeFileSync(path.join(cwd, "icon.svg"), SVG_BYTES);
    fs.writeFileSync(path.join(cwd, "notes.txt"), TEXT_BYTES);
    fs.mkdirSync(path.join(cwd, "nested"));
    fs.writeFileSync(path.join(cwd, "nested", "photo.jpg"), PNG_BYTES);
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const fileUrl = (params: Record<string, string>): string => {
    const url = new URL(`http://127.0.0.1:${server.port}/api/file`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  };

  it("serves an image with the right content type", async () => {
    const response = await fetch(fileUrl({ cwd, path: "pic.png" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("serves a nested image path", async () => {
    const response = await fetch(fileUrl({ cwd, path: "nested/photo.jpg" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("serves an svg with a script-blocking CSP", async () => {
    const response = await fetch(fileUrl({ cwd, path: "icon.svg" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    // default-src 'none' blocks scripts (script-src falls back to it); style-src
    // stays permissive so inline-styled SVGs still render.
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
  });

  it("omits a CSP for raster images", async () => {
    const response = await fetch(fileUrl({ cwd, path: "pic.png" }));
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("refuses non-image files", async () => {
    const response = await fetch(fileUrl({ cwd, path: "notes.txt" }));
    expect(response.status).toBe(404);
  });

  it("rejects a path traversal attempt", async () => {
    const response = await fetch(fileUrl({ cwd, path: "../notes.txt" }));
    expect(response.status).toBe(400);
  });

  it("rejects an absolute path", async () => {
    const response = await fetch(fileUrl({ cwd, path: "/etc/passwd" }));
    expect(response.status).toBe(400);
  });

  it("rejects a missing cwd", async () => {
    const response = await fetch(fileUrl({ path: "pic.png" }));
    expect(response.status).toBe(400);
  });

  it("returns 404 for a missing image", async () => {
    const response = await fetch(fileUrl({ cwd, path: "missing.png" }));
    expect(response.status).toBe(404);
  });
});
