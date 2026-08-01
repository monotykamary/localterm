import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  isTerminalBrowserFramePath,
  parseTerminalBrowserTransmit,
  TerminalBrowserFrameScanner,
} from "../src/terminal-browser-frame-scanner.js";

const ESC = "\x1b";
const encode = (value: string) => Buffer.from(value).toString("base64");
const transmit = (name: string, width = 800, height = 600, imageId = 1) =>
  `${ESC}_Ga=T,f=32,s=${width},v=${height},t=f,i=${imageId},p=1,C=1,q=2;${encode(name)}${ESC}\\`;

describe("parseTerminalBrowserTransmit", () => {
  it("parses a kitty file-medium transmit body", () => {
    const body = `a=T,f=32,s=1280,v=720,t=f,i=3,p=1,C=1,q=2;${encode("/tmp/frame.rgba")}`;
    expect(parseTerminalBrowserTransmit(body)).toEqual({
      width: 1280,
      height: 720,
      imageId: 3,
      name: "/tmp/frame.rgba",
    });
  });

  it("rejects non-file transmits", () => {
    expect(parseTerminalBrowserTransmit(`a=T,f=32,s=1280,v=720,t=d,i=1;cGF5bG9hZA`)).toBeNull();
    expect(parseTerminalBrowserTransmit(`a=q,t=f;cGF5bG9hZA`)).toBeNull();
  });

  it("rejects malformed sizes", () => {
    expect(parseTerminalBrowserTransmit(`a=T,t=f,s=0,v=720;cGF5bG9hZA`)).toBeNull();
  });
});

describe("isTerminalBrowserFramePath", () => {
  const tmpdir = "/tmp/terminal-browser-tests";

  it("accepts a terminal-browser temp frame file", () => {
    expect(
      isTerminalBrowserFramePath(path.join(tmpdir, "terminal-browser-1234-1-0.rgba"), tmpdir),
    ).toBe(true);
  });

  it("rejects paths outside the temp dir", () => {
    expect(isTerminalBrowserFramePath("/etc/passwd", tmpdir)).toBe(false);
    expect(isTerminalBrowserFramePath("/tmp/other-1234-1-0.rgba", tmpdir)).toBe(false);
  });

  it("rejects names that are not terminal-browser frame files", () => {
    expect(isTerminalBrowserFramePath(path.join(tmpdir, "evil-1234-1-0.rgba"), tmpdir)).toBe(false);
  });
});

describe("TerminalBrowserFrameScanner", () => {
  const tmpdir = "/tmp/terminal-browser-tests";
  const allowed = (name: string) => isTerminalBrowserFramePath(name, tmpdir);
  const framePath = path.join(tmpdir, "terminal-browser-99-1-2.rgba");

  it("emits a complete file-transmit frame", () => {
    const scanner = new TerminalBrowserFrameScanner(allowed);
    const frames = scanner.push("prefix text " + transmit(framePath, 640, 480, 7));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ width: 640, height: 480, imageId: 7, path: framePath });
  });

  it("reassembles a transmit split across data events", () => {
    const scanner = new TerminalBrowserFrameScanner(allowed);
    const chunk = "x " + transmit(framePath, 320, 200, 1);
    const mid = 20;
    expect(scanner.push(chunk.slice(0, mid))).toHaveLength(0);
    const frames = scanner.push(chunk.slice(mid));
    expect(frames).toHaveLength(1);
    expect(frames[0].path).toBe(framePath);
  });

  it("ignores a file transmit whose path is outside the temp dir", () => {
    const scanner = new TerminalBrowserFrameScanner(allowed);
    expect(scanner.push(transmit("/etc/something.rgba", 640, 480, 1))).toHaveLength(0);
  });

  it("ignores inline (direct) transmits", () => {
    const scanner = new TerminalBrowserFrameScanner(allowed);
    expect(
      scanner.push(`${ESC}_Ga=T,f=32,o=z,s=1,v=1,t=d,i=1,q=2,m=0;cGF5bG9hZA${ESC}\\`),
    ).toHaveLength(0);
  });

  it("emits multiple frames in one push", () => {
    const scanner = new TerminalBrowserFrameScanner(allowed);
    const frames = scanner.push(transmit(framePath, 1, 1, 1) + transmit(framePath, 2, 2, 2));
    expect(frames.map((frame) => frame.imageId)).toEqual([1, 2]);
  });
});
