import { describe, expect, it } from "vite-plus/test";
import { parseImportedTheme } from "../../src/utils/parse-imported-theme";

describe("parseImportedTheme", () => {
  it("parses a JSON theme with a colors object and uses the provided name", () => {
    const json = JSON.stringify({
      name: "My Theme",
      colors: {
        background: "#0a0a0a",
        foreground: "#eeeeee",
        cursor: "#ff0000",
        black: "#000000",
        red: "#ff0000",
        green: "#00ff00",
      },
    });
    const result = parseImportedTheme(json, "my-theme.json");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.theme.name).toBe("My Theme");
    expect(result.theme.source).toBe("imported");
    expect(result.theme.id).toMatch(/^custom-/);
    expect(result.theme.colors.background).toBe("#0a0a0a");
    expect(result.theme.colors.red).toBe("#ff0000");
  });

  it("parses a bare colors object (the xterm ITheme shape) and derives the name from the file", () => {
    const json = JSON.stringify({
      background: "#111111",
      foreground: "#dddddd",
      black: "#000000",
      white: "#ffffff",
    });
    const result = parseImportedTheme(json, "flat.json");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.theme.name).toBe("flat");
    expect(result.theme.colors.background).toBe("#111111");
    expect(result.theme.colors.white).toBe("#ffffff");
  });

  it("normalizes #rgb and drops alpha from #rrggbbaa", () => {
    const json = JSON.stringify({ colors: { background: "#abc", foreground: "#112233aa" } });
    const result = parseImportedTheme(json, "t.json");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.theme.colors.background).toBe("#aabbcc");
    expect(result.theme.colors.foreground).toBe("#112233");
  });

  it("omits fields that aren't valid hex so xterm keeps its per-field default", () => {
    const json = JSON.stringify({ colors: { background: "not-a-color", foreground: "#00ff00" } });
    const result = parseImportedTheme(json, "t.json");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.theme.colors.background).toBeUndefined();
    expect(result.theme.colors.foreground).toBe("#00ff00");
  });

  it("rejects invalid JSON with an error message", () => {
    const result = parseImportedTheme("{not json", "t.json");
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toContain("JSON");
  });

  it("rejects an empty file", () => {
    const result = parseImportedTheme("   ", "t.json");
    expect("error" in result).toBe(true);
  });

  it("parses an iTerm .itermcolors plist, mapping components to hex", () => {
    // A minimal iTerm plist: background (0.04, 0.04, 0.04 -> #0a0a0a) and
    // Ansi 1 Color (1.0, 0.0, 0.0 -> #ff0000).
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Background Color</key>
  <dict>
    <key>Red Component</key><real>0.0392</real>
    <key>Green Component</key><real>0.0392</real>
    <key>Blue Component</key><real>0.0392</real>
  </dict>
  <key>Foreground Color</key>
  <dict>
    <key>Red Component</key><real>0.933</real>
    <key>Green Component</key><real>0.933</real>
    <key>Blue Component</key><real>0.933</real>
  </dict>
  <key>Ansi 1 Color</key>
  <dict>
    <key>Red Component</key><real>1</real>
    <key>Green Component</key><real>0</real>
    <key>Blue Component</key><real>0</real>
  </dict>
</dict>
</plist>`;
    const result = parseImportedTheme(plist, "vesper.itermcolors");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.theme.name).toBe("vesper");
    expect(result.theme.colors.background).toBe("#0a0a0a");
    expect(result.theme.colors.foreground).toBe("#eeeeee");
    expect(result.theme.colors.red).toBe("#ff0000");
  });

  it("rejects an iTerm plist with no recognized color entries", () => {
    const plist = `<?xml version="1.0"?><plist version="1.0"><dict><key>Unused</key><string>x</string></dict></plist>`;
    const result = parseImportedTheme(plist, "empty.itermcolors");
    expect("error" in result).toBe(true);
  });
});
