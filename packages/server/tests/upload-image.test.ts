import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";
import {
  deletePasteImagesForSession,
  pasteImageDirForSession,
} from "../src/utils/paste-image-store.js";

describe("/api/upload-image", () => {
  let stateDirectory: string;
  let server: RunningServer;
  const sessionId = "test-session-id";

  beforeEach(async () => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-upload-image-"));
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
    deletePasteImagesForSession(sessionId);
  });

  const uploadUrl = (sid: string | null = sessionId) => {
    const url = new URL(`http://127.0.0.1:${server.port}/api/upload-image`);
    if (sid) url.searchParams.set("sid", sid);
    return url.toString();
  };

  const postImage = (body: FormData, sid: string | null = sessionId) =>
    fetch(uploadUrl(sid), { method: "POST", body });

  it("writes a pasted image into the session's temp dir and returns its absolute path", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const form = new FormData();
    form.append("image", new Blob([bytes], { type: "image/png" }), "screenshot.png");

    const response = await postImage(form);
    expect(response.status).toBe(201);
    const { path: returnedPath } = (await response.json()) as { path: string };

    const dir = pasteImageDirForSession(sessionId);
    expect(returnedPath.startsWith(dir + path.sep)).toBe(true);
    expect(returnedPath).toMatch(/pasted-\d+-[0-9a-f]{8}\.png$/);
    expect(fs.existsSync(returnedPath)).toBe(true);
    expect(new Uint8Array(fs.readFileSync(returnedPath))).toEqual(bytes);
  });

  it("deletes the session's paste dir on teardown", async () => {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "x.png");
    await postImage(form);
    const dir = pasteImageDirForSession(sessionId);
    expect(fs.existsSync(dir)).toBe(true);
    deletePasteImagesForSession(sessionId);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("rejects a non-image content type with 415 unsupported_type", async () => {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array([1, 2, 3])], { type: "text/plain" }), "note.txt");

    const response = await postImage(form);
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: string }).error).toBe("unsupported_type");
    expect(fs.existsSync(pasteImageDirForSession(sessionId))).toBe(false);
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

  it("rejects a missing session id with 400 invalid_session", async () => {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array([1])], { type: "image/png" }), "x.png");

    const response = await postImage(form, null);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_session");
  });

  it("rejects a path-traversal session id with 400 invalid_session", async () => {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array([1])], { type: "image/png" }), "x.png");

    const response = await postImage(form, "../../etc");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_session");
  });
});
