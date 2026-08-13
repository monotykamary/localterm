import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";

const entryUrl = new URL("../dist/index.mjs", import.meta.url);

describe("published extension entry", () => {
  it("keeps pi runtime imports in the entry module handled by pi's loader", async () => {
    const entry = await readFile(entryUrl, "utf8");

    expect(entry).toContain('from "@earendil-works/pi-coding-agent"');
    expect(entry).toContain('from "@earendil-works/pi-tui"');
    expect(entry).not.toMatch(/\bimport\(["']\.\//u);
  });
});
