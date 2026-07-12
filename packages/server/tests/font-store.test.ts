import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { FontStore } from "../src/font-store.js";
import { DEFAULT_TERMINAL_FONT_ID } from "../src/terminal-fonts.js";

const fontFile = (stateDirectory: string): string => path.join(stateDirectory, "fonts.json");

describe("FontStore", () => {
  let stateDirectory: string;

  beforeEach(() => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-fonts-"));
  });

  afterEach(() => {
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("defaults to the built-in default font + empty family + toggles off + uninitialized", () => {
    const store = new FontStore({ filePath: fontFile(stateDirectory) });
    expect(store.getActive()).toBe(DEFAULT_TERMINAL_FONT_ID);
    expect(store.getCustomFontFamily()).toBe("");
    expect(store.getNerdFontEnabled()).toBe(false);
    expect(store.getLigaturesEnabled()).toBe(false);
    expect(store.isInitialized()).toBe(false);
  });

  it("applies a partial update and persists across a new instance", () => {
    const store = new FontStore({ filePath: fontFile(stateDirectory) });
    store.update({ activeFontId: "jetbrains-mono" });
    store.update({ customFontFamily: "JetBrainsMono Nerd Font Mono" });
    store.update({ nerdFontEnabled: true });
    store.update({ ligaturesEnabled: true });
    expect(store.getActive()).toBe("jetbrains-mono");
    expect(store.getCustomFontFamily()).toBe("JetBrainsMono Nerd Font Mono");
    expect(store.getNerdFontEnabled()).toBe(true);
    expect(store.getLigaturesEnabled()).toBe(true);
    expect(store.isInitialized()).toBe(true);

    const reloaded = new FontStore({ filePath: fontFile(stateDirectory) });
    expect(reloaded.getActive()).toBe("jetbrains-mono");
    expect(reloaded.getCustomFontFamily()).toBe("JetBrainsMono Nerd Font Mono");
    expect(reloaded.getNerdFontEnabled()).toBe(true);
    expect(reloaded.getLigaturesEnabled()).toBe(true);
    expect(reloaded.isInitialized()).toBe(true);
  });

  it("update applies only the supplied fields", () => {
    const store = new FontStore({ filePath: fontFile(stateDirectory) });
    store.update({ activeFontId: "fira-code", nerdFontEnabled: true });
    store.update({ ligaturesEnabled: true });
    expect(store.getActive()).toBe("fira-code");
    expect(store.getNerdFontEnabled()).toBe(true);
    expect(store.getLigaturesEnabled()).toBe(true);
    expect(store.getCustomFontFamily()).toBe("");
  });

  it("sanitizes a stale active id back to the default on load", () => {
    fs.writeFileSync(
      fontFile(stateDirectory),
      JSON.stringify({
        version: 1,
        activeFontId: "totally-made-up",
        customFontFamily: "X",
        nerdFontEnabled: false,
        ligaturesEnabled: false,
      }),
    );
    const store = new FontStore({ filePath: fontFile(stateDirectory) });
    expect(store.getActive()).toBe(DEFAULT_TERMINAL_FONT_ID);
    expect(store.getCustomFontFamily()).toBe("X");
    expect(store.isInitialized()).toBe(true);
  });

  it("keeps the custom pseudo-id as a valid active id", () => {
    fs.writeFileSync(
      fontFile(stateDirectory),
      JSON.stringify({
        version: 1,
        activeFontId: "custom",
        customFontFamily: "MesloLGS NF",
        nerdFontEnabled: true,
        ligaturesEnabled: false,
      }),
    );
    const store = new FontStore({ filePath: fontFile(stateDirectory) });
    expect(store.getActive()).toBe("custom");
    expect(store.getCustomFontFamily()).toBe("MesloLGS NF");
    expect(store.getNerdFontEnabled()).toBe(true);
  });

  it("migrate adopts the payload once, then no-ops", () => {
    const store = new FontStore({ filePath: fontFile(stateDirectory) });
    expect(store.isInitialized()).toBe(false);

    const adopted = store.migrate({
      activeFontId: "jetbrains-mono",
      customFontFamily: "JetBrainsMono Nerd Font Mono",
      nerdFontEnabled: true,
      ligaturesEnabled: false,
    });
    expect(adopted).toBe(true);
    expect(store.getActive()).toBe("jetbrains-mono");
    expect(store.getCustomFontFamily()).toBe("JetBrainsMono Nerd Font Mono");
    expect(store.getNerdFontEnabled()).toBe(true);
    expect(store.isInitialized()).toBe(true);

    // A second call (e.g. another tab) must not clobber the now-initialized store.
    const second = store.migrate({
      activeFontId: "fira-code",
      customFontFamily: "Other",
      nerdFontEnabled: false,
      ligaturesEnabled: true,
    });
    expect(second).toBe(false);
    expect(store.getActive()).toBe("jetbrains-mono");
    expect(store.getCustomFontFamily()).toBe("JetBrainsMono Nerd Font Mono");
  });

  it("migrate sanitizes a stale active id to the default", () => {
    const store = new FontStore({ filePath: fontFile(stateDirectory) });
    store.migrate({
      activeFontId: "no-such-font",
      customFontFamily: "",
      nerdFontEnabled: false,
      ligaturesEnabled: false,
    });
    expect(store.getActive()).toBe(DEFAULT_TERMINAL_FONT_ID);
  });

  it("ignores an unparseable file and keeps the defaults", () => {
    fs.writeFileSync(fontFile(stateDirectory), "{not json");
    const store = new FontStore({ filePath: fontFile(stateDirectory) });
    expect(store.getActive()).toBe(DEFAULT_TERMINAL_FONT_ID);
    expect(store.getCustomFontFamily()).toBe("");
    expect(store.isInitialized()).toBe(false);
  });
});
