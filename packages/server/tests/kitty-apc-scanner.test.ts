import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { KittyApcScanner } from "../src/kitty-apc-scanner.js";

const ESC = "\x1b";
const encode = (value: string) => Buffer.from(value).toString("base64");

describe("KittyApcScanner", () => {
  const tmpdir = process.env.TMPDIR || os.tmpdir();
  const realTmp = fs.realpathSync(tmpdir);
  const isAllowedPath = (name: string) => {
    try {
      return fs.realpathSync(name).startsWith(realTmp + path.sep);
    } catch {
      return false;
    }
  };

  const makeFile = (name: string, size: number): string => {
    const file = path.join(tmpdir, name);
    fs.writeFileSync(file, Buffer.alloc(size, 9));
    return file;
  };

  const transmit = (name: string, w = 4, h = 3, imageId = 7) =>
    `${ESC}_Ga=T,f=32,s=${w},v=${h},t=f,i=${imageId},q=0;${encode(name)}${ESC}\\`;
  const probe = (name: string, id = 300) =>
    `${ESC}_Gi=${id},a=q,t=f,f=32,s=1,v=1;${encode(name)}${ESC}\\`;

  it("parses a file-medium transmit frame", () => {
    const file = makeFile("kitty-frame-a.rgba", 4 * 3 * 4);
    const scanner = new KittyApcScanner(isAllowedPath);
    const scan = scanner.push("out " + transmit(file));
    expect(scan.frames).toEqual([{ width: 4, height: 3, imageId: 7, path: file }]);
    expect(scan.probes).toEqual([]);
    expect(scan.output).toContain(transmit(file));
    fs.rmSync(file, { force: true });
  });

  it("detects and strips a file-medium probe", () => {
    const file = makeFile("kitty-probe-a.rgba", 4);
    const scanner = new KittyApcScanner(isAllowedPath);
    const text = "hello " + probe(file, 300) + " world";
    const scan = scanner.push(text);
    expect(scan.probes).toEqual([{ imageId: 300, quiet: 0, path: file }]);
    expect(scan.frames).toEqual([]);
    expect(scan.output).toBe("hello  world");
    fs.rmSync(file, { force: true });
  });

  it("reassembles a transmit split across data events", () => {
    const file = makeFile("kitty-frame-b.rgba", 2 * 2 * 4);
    const scanner = new KittyApcScanner(isAllowedPath);
    const chunk = transmit(file, 2, 2, 3);
    const first = scanner.push(chunk.slice(0, 10));
    expect(first.frames).toEqual([]);
    const second = scanner.push(chunk.slice(10));
    expect(second.frames).toEqual([{ width: 2, height: 2, imageId: 3, path: file }]);
    fs.rmSync(file, { force: true });
  });

  it("ignores paths outside the temp root", () => {
    const scanner = new KittyApcScanner(isAllowedPath);
    const outside = path.join("/", "tmp-no" + "t-temp", "frame.rgba");
    const scan = scanner.push(transmit(outside, 4, 3, 1));
    expect(scan.frames).toEqual([]);
    expect(scan.output).toContain(transmit(outside, 4, 3, 1));
  });

  it("ignores non-file transmissions", () => {
    const scanner = new KittyApcScanner(isAllowedPath);
    const inline = `${ESC}_Ga=T,f=32,o=z,s=1,v=1,t=d,i=1,q=2,m=0;cGF5bG9hZA==${ESC}\\`;
    const scan = scanner.push(inline);
    expect(scan.frames).toEqual([]);
    expect(scan.probes).toEqual([]);
    expect(scan.output).toBe(inline);
  });

  it("ignores shared-memory mediums", () => {
    const scanner = new KittyApcScanner(isAllowedPath);
    const shm = `${ESC}_Ga=T,f=32,s=4,v=4,t=s,i=2,q=2;${encode("/px-9-1")}${ESC}\\`;
    const scan = scanner.push(shm);
    expect(scan.frames).toEqual([]);
    expect(scan.output).toBe(shm);
  });
  it("classifies ordered PNG file transmissions for direct browser conversion", () => {
    const file = path.join(tmpdir, "kitty-inline.png");
    fs.writeFileSync(
      file,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAMAAAAsPuSGAAAACVBMVEX/AAAA/wAAAP8tSs2KAAAADElEQVR4nGNgYGQCAAAIAAQ24LCmAAAAHXRFWHRTb2Z0d2FyZQBAbHVuYXBhaW50L3BuZy1jb2RlY/VDGR4AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const sequence = `${ESC}_Ga=t,f=100,t=f,U=1,i=42,q=2;${encode(file)}${ESC}\\`;
    const scanner = new KittyApcScanner(isAllowedPath);
    const scan = scanner.push(`before${sequence}after`);

    expect(scan.output).toBe(`before${sequence}after`);
    expect(scan.outputParts).toEqual([
      { kind: "text", text: "before" },
      {
        kind: "file",
        transmission: {
          controls: { a: "t", f: "100", t: "f", U: "1", i: "42", q: "2" },
          original: sequence,
          path: file,
          temporary: false,
        },
      },
      { kind: "text", text: "after" },
    ]);
    fs.rmSync(file, { force: true });
  });

  it("classifies temporary-file media separately from persistent files", () => {
    const file = makeFile("kitty-temporary.rgb", 3);
    const sequence = `${ESC}_Ga=t,f=24,s=1,v=1,t=t,i=8;${encode(file)}${ESC}\\`;
    const scanner = new KittyApcScanner(isAllowedPath);
    const scan = scanner.push(sequence);

    expect(scan.outputParts[0]).toMatchObject({
      kind: "file",
      transmission: { path: file, temporary: true },
    });
    fs.rmSync(file, { force: true });
  });

  it("routes virtual and transmit-only RGBA files through ordered direct conversion", () => {
    const file = makeFile("kitty-virtual-rgba.bin", 4);
    const virtual = `${ESC}_Ga=T,f=32,s=1,v=1,t=f,U=1,i=51;${encode(file)}${ESC}\\`;
    const transmitOnly = `${ESC}_Ga=t,f=32,s=1,v=1,t=f,i=52;${encode(file)}${ESC}\\`;
    const scanner = new KittyApcScanner(isAllowedPath);

    const virtualScan = scanner.push(virtual);
    const transmitScan = scanner.push(transmitOnly);

    expect(virtualScan.frames).toEqual([]);
    expect(virtualScan.outputParts[0]).toMatchObject({ kind: "file" });
    expect(transmitScan.frames).toEqual([]);
    expect(transmitScan.outputParts[0]).toMatchObject({ kind: "file" });
    fs.rmSync(file, { force: true });
  });
});
