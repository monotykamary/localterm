import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { KittyApcScanner } from "../src/kitty-apc-scanner.js";
import {
  expandKittyApcOutputParts,
  expandKittyFileTransmission,
} from "../src/kitty-file-transmission.js";

const ESC = "\x1b";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAMAAAAsPuSGAAAACVBMVEX/AAAA/wAAAP8tSs2KAAAADElEQVR4nGNgYGQCAAAIAAQ24LCmAAAAHXRFWHRTb2Z0d2FyZQBAbHVuYXBhaW50L3BuZy1jb2RlY/VDGR4AAAAASUVORK5CYII=",
  "base64",
);
const encode = (value: string) => Buffer.from(value).toString("base64");

describe("Kitty file transmission conversion", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-kitty-file-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const scanner = () =>
    new KittyApcScanner((name) => {
      try {
        return fs.realpathSync(name).startsWith(fs.realpathSync(root) + path.sep);
      } catch {
        return false;
      }
    });

  it("rewrites image.nvim PNG file media to direct U=1 chunks in place", async () => {
    const file = path.join(root, "image.png");
    fs.writeFileSync(file, PNG);
    const sequence = `${ESC}_Ga=t,f=100,t=f,U=1,i=42,q=2;${encode(file)}${ESC}\\`;
    const scan = scanner().push(`before${sequence}after`);

    const output = await expandKittyApcOutputParts(scan.outputParts, fs.realpathSync(root));

    expect(output).toBe(
      `before${ESC}_Ga=t,f=100,t=d,U=1,i=42,q=2,m=0;${PNG.toString("base64")}${ESC}\\after`,
    );
    expect(output).not.toContain(encode(file));
  });

  it("honors file offset and size without reading unrelated bytes", async () => {
    const file = path.join(root, "offset.png");
    const prefix = Buffer.from("ignored-prefix");
    fs.writeFileSync(file, Buffer.concat([prefix, PNG, Buffer.from("ignored-suffix")]));
    const sequence = `${ESC}_Ga=t,f=100,t=f,i=7,O=${prefix.length},S=${PNG.length};${encode(file)}${ESC}\\`;
    const scan = scanner().push(sequence);

    const output = await expandKittyApcOutputParts(scan.outputParts, fs.realpathSync(root));

    expect(output).toContain(`t=d,i=7,m=0;${PNG.toString("base64")}`);
    expect(output).not.toContain("O=");
    expect(output).not.toContain("S=");
  });

  it("chunks large payloads on base64 boundaries", async () => {
    const file = path.join(root, "large.png");
    fs.writeFileSync(file, Buffer.concat([PNG, Buffer.alloc(8_192)]));
    const sequence = `${ESC}_Ga=t,f=100,t=f,i=9;${encode(file)}${ESC}\\`;
    const scan = scanner().push(sequence);

    const output = await expandKittyApcOutputParts(scan.outputParts, fs.realpathSync(root));

    expect(output.split(`${ESC}_G`).length - 1).toBeGreaterThan(2);
    expect(output).toContain("t=d,i=9,m=1;");
    expect(output).toContain(`${ESC}_Gm=0;`);
  });

  it("converts bounded raw RGB files", async () => {
    const file = path.join(root, "pixel.rgb");
    fs.writeFileSync(file, Buffer.from([255, 0, 128]));
    const sequence = `${ESC}_Ga=t,f=24,s=1,v=1,t=t,i=3;${encode(file)}${ESC}\\`;
    const scan = scanner().push(sequence);

    const output = await expandKittyApcOutputParts(scan.outputParts, fs.realpathSync(root));

    expect(output).toContain("a=t,f=24,s=1,v=1,t=d,i=3,m=0;/wCA");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("uses the protocol default RGBA format when f is omitted", async () => {
    const file = path.join(root, "default.rgba");
    fs.writeFileSync(file, Buffer.from([12, 34, 56, 255]));
    const sequence = `${ESC}_Ga=t,s=1,v=1,t=f,U=1,i=4;${encode(file)}${ESC}\\`;
    const scan = scanner().push(sequence);

    const output = await expandKittyApcOutputParts(scan.outputParts, fs.realpathSync(root));

    expect(output).toContain("a=t,s=1,v=1,t=d,U=1,i=4,m=0;DCI4/w==");
  });

  it("leaves invalid or escaped files untouched", async () => {
    const outside = path.join(os.tmpdir(), `outside-kitty-${process.pid}.png`);
    fs.writeFileSync(outside, PNG);
    const original = `${ESC}_Ga=t,f=100,t=f,i=5;${encode(outside)}${ESC}\\`;
    try {
      const output = await expandKittyFileTransmission(
        {
          controls: { a: "t", f: "100", t: "f", i: "5" },
          original,
          path: outside,
          temporary: false,
        },
        fs.realpathSync(root),
      );
      expect(output).toBe(original);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
