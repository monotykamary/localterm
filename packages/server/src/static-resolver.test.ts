import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveStaticAsset } from "./static-resolver.js";

let staticRoot: string;
let secretPath: string;
let secretBody: string;

const decode = (asset: { body: Buffer } | null): string =>
  asset ? asset.body.toString("utf8") : "";

beforeAll(() => {
  staticRoot = mkdtempSync(path.join(os.tmpdir(), "localterm-static-"));
  writeFileSync(path.join(staticRoot, "index.html"), "<!doctype html><title>root</title>");
  writeFileSync(path.join(staticRoot, "app.js"), "console.log('app');");
  mkdirSync(path.join(staticRoot, "assets"), { recursive: true });
  writeFileSync(path.join(staticRoot, "assets", "logo.svg"), "<svg/>");

  secretPath = path.join(path.dirname(staticRoot), "secret.txt");
  secretBody = "DO_NOT_LEAK_TOKEN";
  writeFileSync(secretPath, secretBody);
});

describe("resolveStaticAsset", () => {
  it("serves an exact file", () => {
    const asset = resolveStaticAsset(staticRoot, "/app.js");
    expect(asset).not.toBeNull();
    expect(asset?.contentType).toBe("text/javascript; charset=utf-8");
  });

  it("serves nested assets", () => {
    const asset = resolveStaticAsset(staticRoot, "/assets/logo.svg");
    expect(asset?.contentType).toBe("image/svg+xml");
  });

  it("falls back to index.html for SPA routes (no extension)", () => {
    const asset = resolveStaticAsset(staticRoot, "/some/spa/route");
    expect(asset?.contentType).toBe("text/html; charset=utf-8");
  });

  it("does not fall back to index.html for missing files with extensions", () => {
    expect(resolveStaticAsset(staticRoot, "/missing.png")).toBeNull();
  });

  it("never leaks files outside the static root via raw traversal", () => {
    expect(decode(resolveStaticAsset(staticRoot, "/../secret.txt"))).not.toContain(secretBody);
    expect(decode(resolveStaticAsset(staticRoot, "/../../etc/passwd"))).not.toContain("root:");
    expect(decode(resolveStaticAsset(staticRoot, "/../secret.txt.png"))).not.toContain(secretBody);
  });

  it("never leaks files outside the static root via URL-encoded traversal", () => {
    expect(decode(resolveStaticAsset(staticRoot, "/..%2Fsecret.txt"))).not.toContain(secretBody);
    expect(decode(resolveStaticAsset(staticRoot, "/%2e%2e/secret.txt"))).not.toContain(secretBody);
    expect(decode(resolveStaticAsset(staticRoot, "/%2e%2e%2fsecret.txt.png"))).not.toContain(
      secretBody,
    );
  });

  it("rejects malformed percent encoding gracefully", () => {
    expect(resolveStaticAsset(staticRoot, "/%E0%A4")).toBeNull();
  });

  it("does not escape root via sibling prefix collision", () => {
    const sibling = `${path.basename(staticRoot)}-suffix`;
    const siblingDir = path.join(path.dirname(staticRoot), sibling);
    mkdirSync(siblingDir, { recursive: true });
    writeFileSync(path.join(siblingDir, "loot.png"), "should not be served");
    expect(decode(resolveStaticAsset(staticRoot, `/${sibling}/loot.png`))).not.toContain(
      "should not be served",
    );
  });
});
