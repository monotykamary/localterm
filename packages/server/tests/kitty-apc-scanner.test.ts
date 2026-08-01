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
});
