import { describe, expect, it } from "vite-plus/test";
import { resolveTerminalLink } from "../../src/utils/resolve-terminal-link";

const CWD = "/Users/me/project";
const UNSUPPORTED = { kind: "unsupported" } as const;

describe("resolveTerminalLink", () => {
  it("resolves a scheme-less markdown href against the pane's live cwd", () => {
    expect(resolveTerminalLink("experiments/vietnam-imports/reports/index.html", CWD)).toEqual({
      kind: "file",
      cwd: CWD,
      path: "experiments/vietnam-imports/reports/index.html",
    });
  });

  it("collapses dot segments rather than passing them to the preview route", () => {
    expect(resolveTerminalLink("./docs/../README.md", CWD)).toEqual({
      kind: "file",
      cwd: CWD,
      path: "README.md",
    });
  });

  it("drops a fragment or query from the previewed file", () => {
    expect(resolveTerminalLink("docs/setup.md#usage", CWD)).toEqual({
      kind: "file",
      cwd: CWD,
      path: "docs/setup.md",
    });
    expect(resolveTerminalLink("docs/setup.md?plain=1", CWD)).toEqual({
      kind: "file",
      cwd: CWD,
      path: "docs/setup.md",
    });
  });

  it("re-expresses an absolute file link as its own parent directory", () => {
    expect(resolveTerminalLink("file:///Users/me/project/src/main.ts", CWD)).toEqual({
      kind: "file",
      cwd: "/Users/me/project/src",
      path: "main.ts",
    });
  });

  it("handles the Windows drive form of absolute paths", () => {
    expect(resolveTerminalLink("file:///C:/Users/me/notes.md", CWD)).toEqual({
      kind: "file",
      cwd: "C:/Users/me",
      path: "notes.md",
    });
    expect(resolveTerminalLink("C:\\Users\\me\\notes.md", CWD)).toEqual({
      kind: "file",
      cwd: "C:/Users/me",
      path: "notes.md",
    });
  });

  it("decodes percent-encoded file paths", () => {
    expect(resolveTerminalLink("file:///Users/me/my%20notes/plan.md", CWD)).toEqual({
      kind: "file",
      cwd: "/Users/me/my notes",
      path: "plan.md",
    });
  });

  it("passes http(s) links through to the browser", () => {
    expect(resolveTerminalLink("https://example.com/dashboard?tab=1#top", CWD)).toEqual({
      kind: "external",
      url: "https://example.com/dashboard?tab=1#top",
    });
    expect(resolveTerminalLink("http://localhost:5173/", CWD)).toEqual({
      kind: "external",
      url: "http://localhost:5173/",
    });
  });

  it("ignores schemes a pane has no business launching", () => {
    const uris = [
      "mailto:someone@example.com",
      "javascript:alert(1)",
      "ssh://host/etc/passwd",
      "vim://evil",
    ];
    for (const uri of uris) expect(resolveTerminalLink(uri, CWD)).toEqual(UNSUPPORTED);
  });

  it("ignores relative hrefs when the pane has no live cwd", () => {
    expect(resolveTerminalLink("reports/index.html", null)).toEqual(UNSUPPORTED);
  });

  it("ignores paths that climb above their root and directory-only links", () => {
    expect(resolveTerminalLink("../../etc/passwd", CWD)).toEqual(UNSUPPORTED);
    expect(resolveTerminalLink("file:///Users/me/project/", CWD)).toEqual(UNSUPPORTED);
  });

  it("ignores blank input", () => {
    expect(resolveTerminalLink("   ", CWD)).toEqual(UNSUPPORTED);
  });
});
