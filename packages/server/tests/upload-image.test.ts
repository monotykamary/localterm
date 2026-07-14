import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";

describe("/api/upload-image", () => {
  let stateDirectory: string;
  let cwd: string;
  let server: RunningServer;

  beforeEach(async () => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-upload-image-"));
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-upload-cwd-"));
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      tabController: { open: async () => null, close: async () => {} },
    });
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const uploadUrl = (cwdOverride: string = cwd) => {
    const url = new URL(`http://127.0.0.1:${server.port}/api/upload-image`);
    url.searchParams.set("cwd", cwdOverride);
    return url.toString();
  };

  const postImage = (body: FormData, cwdOverride?: string) =>
    fetch(uploadUrl(cwdOverride), { method: "POST", body });

  it("writes a pasted image into the cwd and returns its absolute path", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const form = new FormData();
    form.append("image", new Blob([bytes], { type: "image/png" }), "screenshot.png");

    const response = await postImage(form);
    expect(response.status).toBe(201);
    const { path: returnedPath } = (await response.json()) as { path: string };

    expect(returnedPath.startsWith(cwd + path.sep)).toBe(true);
    expect(returnedPath).toMatch(/pasted-\d+-[0-9a-f]{8}\.png$/);
    expect(fs.existsSync(returnedPath)).toBe(true);
    expect(new Uint8Array(fs.readFileSync(returnedPath))).toEqual(bytes);
  });

  it("rejects a non-image content type with 415 unsupported_type", async () => {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array([1, 2, 3])], { type: "text/plain" }), "note.txt");

    const response = await postImage(form);
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: string }).error).toBe("unsupported_type");
    expect(fs.readdirSync(cwd).length).toBe(0);
  });

  it("rejects an svg upload (text, not a raster paste) with 415", async () => {
    const form = new FormData();
    form.append(
      "image",
      new Blob([new TextEncoder().encode("<svg/>")], { type: "image/svg+xml" }),
      "icon.svg",
    );

    const response = await postImage(form);
    expect(response.status).toBe(415);
  });

  it("rejects a missing image field with 400 invalid_body", async () => {
    const form = new FormData();

    const response = await postImage(form);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_body");
  });

  it("rejects an unknown cwd with 400 invalid_cwd", async () => {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array([1])], { type: "image/png" }), "x.png");

    const response = await postImage(form, path.join(cwd, "does-not-exist"));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_cwd");
  });
});
