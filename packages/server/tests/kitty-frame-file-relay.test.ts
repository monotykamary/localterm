import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { readPixelFrame } from "../src/kitty-frame-file-relay.js";

describe("readPixelFrame", () => {
  const tmpdir = process.env.TMPDIR || os.tmpdir();
  const tmpdirRoot = fs.realpathSync(tmpdir);

  const frameAt = (name: string, size: number) => {
    const file = path.join(tmpdir, name);
    fs.writeFileSync(file, Buffer.alloc(size, 7));
    return file;
  };

  it("reads a well-formed frame", async () => {
    const file = frameAt("frame-read-a.rgba", 4 * 2 * 4);
    const pixels = await readPixelFrame(
      { width: 4, height: 2, imageId: 1, path: file },
      tmpdirRoot,
    );
    expect(pixels).not.toBeNull();
    expect(pixels?.length).toBe(32);
    fs.rmSync(file, { force: true });
  });

  it("rejects size mismatches", async () => {
    const file = frameAt("frame-read-b.rgba", 10);
    expect(
      await readPixelFrame({ width: 4, height: 2, imageId: 1, path: file }, tmpdirRoot),
    ).toBeNull();
    fs.rmSync(file, { force: true });
  });

  it("rejects missing files", async () => {
    const missing = path.join(tmpdir, "no-such-frame.rgba");
    expect(
      await readPixelFrame({ width: 4, height: 2, imageId: 1, path: missing }, tmpdirRoot),
    ).toBeNull();
  });

  it("rejects paths outside the temp root", async () => {
    const outside = "/etc/passwd";
    expect(
      await readPixelFrame({ width: 1, height: 1, imageId: 1, path: outside }, tmpdirRoot),
    ).toBeNull();
  });

  it("rejects oversized frames", async () => {
    const file = frameAt("frame-read-c.rgba", 4);
    expect(
      await readPixelFrame({ width: 3_000_000, height: 3_000, imageId: 1, path: file }, tmpdirRoot),
    ).toBeNull();
    fs.rmSync(file, { force: true });
  });
});
