import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";
import {
  DEFAULT_DARK_TERMINAL_THEME_ID,
  DEFAULT_LIGHT_TERMINAL_THEME_ID,
  DEFAULT_TERMINAL_THEME_ID,
} from "../src/terminal-themes.js";

const JSON_THEME = JSON.stringify({
  name: "Mine",
  colors: { background: "#0a0a0a", foreground: "#eeeeee", red: "#ff0000" },
});

const ITERM_PLIST = `<?xml version="1.0"?>
<plist version="1.0"><dict>
  <key>Background Color</key><dict>
    <key>Red Component</key><real>0.0392</real>
    <key>Green Component</key><real>0.0392</real>
    <key>Blue Component</key><real>0.0392</real>
  </dict>
  <key>Ansi 1 Color</key><dict>
    <key>Red Component</key><real>1</real>
    <key>Green Component</key><real>0</real>
    <key>Blue Component</key><real>0</real>
  </dict>
</dict></plist>`;

describe("/api/themes", () => {
  let stateDirectory: string;
  let server: RunningServer;

  beforeEach(async () => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-themes-api-"));
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      tabController: { open: async () => null, close: async () => {} },
    });
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  const themesUrl = () => `http://127.0.0.1:${server.port}/api/themes`;

  it("GET returns the default state and is uninitialized before any write", async () => {
    const response = await fetch(themesUrl());
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body).toMatchObject({
      activeThemeId: DEFAULT_TERMINAL_THEME_ID,
      lightThemeId: DEFAULT_LIGHT_TERMINAL_THEME_ID,
      darkThemeId: DEFAULT_DARK_TERMINAL_THEME_ID,
      customThemes: [],
      initialized: false,
    });
  });

  it("imports a JSON theme, selects it, and marks the store initialized", async () => {
    const imported = await fetch(`${themesUrl()}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: JSON_THEME, filename: "mine.json" }),
    });
    expect(imported.status).toBe(201);
    const theme = (await imported.json()).theme;
    expect(theme.name).toBe("Mine");
    expect(theme.id).toMatch(/^custom-/);
    expect(theme.colors.background).toBe("#0a0a0a");

    // The store is now initialized (the browser won't re-migrate).
    const state = await (await fetch(themesUrl())).json();
    expect(state.initialized).toBe(true);
    expect(state.customThemes.map((entry: { id: string }) => entry.id)).toEqual([theme.id]);

    // set <id> to the freshly imported custom theme.
    const setActive = await fetch(`${themesUrl()}/active`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: theme.id }),
    });
    expect(setActive.ok).toBe(true);
    expect((await setActive.json()).activeThemeId).toBe(theme.id);
  });

  it("imports an iTerm .itermcolors plist", async () => {
    const imported = await fetch(`${themesUrl()}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: ITERM_PLIST, filename: "vesper.itermcolors" }),
    });
    expect(imported.status).toBe(201);
    const theme = (await imported.json()).theme;
    expect(theme.name).toBe("vesper");
    expect(theme.colors.background).toBe("#0a0a0a");
    expect(theme.colors.red).toBe("#ff0000");
  });

  it("rejects a malformed theme file with 400 invalid_theme", async () => {
    const response = await fetch(`${themesUrl()}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "{not json", filename: "bad.json" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_theme");
    expect(typeof body.message).toBe("string");
  });

  it("rejects setting an unknown active id with 404", async () => {
    const response = await fetch(`${themesUrl()}/active`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "totally-made-up" }),
    });
    expect(response.status).toBe(404);
  });

  it("accepts a built-in id (incl. auto) as the active theme", async () => {
    const response = await fetch(`${themesUrl()}/active`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "auto" }),
    });
    expect(response.ok).toBe(true);
    expect((await response.json()).activeThemeId).toBe("auto");
  });

  it("updates the light and dark themes used by system detection", async () => {
    const response = await fetch(`${themesUrl()}/system`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lightThemeId: "solarized-light", darkThemeId: "dracula" }),
    });
    expect(response.ok).toBe(true);

    const state = await (await fetch(themesUrl())).json();
    expect(state.lightThemeId).toBe("solarized-light");
    expect(state.darkThemeId).toBe("dracula");
  });

  it("deletes a custom theme and resets the active id when it was active", async () => {
    const imported = await (
      await fetch(`${themesUrl()}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: JSON_THEME, filename: "mine.json" }),
      })
    ).json();
    const id = imported.theme.id;
    await fetch(`${themesUrl()}/active`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const deleted = await fetch(`${themesUrl()}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    expect(deleted.ok).toBe(true);
    expect((await deleted.json()).activeThemeId).toBe(DEFAULT_TERMINAL_THEME_ID);

    const again = await fetch(`${themesUrl()}/${encodeURIComponent(id)}`, { method: "DELETE" });
    expect(again.status).toBe(404);
  });

  it("migrate adopts the browser's legacy state once, then no-ops", async () => {
    const payload = {
      activeThemeId: "custom-legacy-1",
      customThemes: [
        {
          id: "custom-legacy-1",
          name: "Legacy",
          source: "imported",
          colors: { background: "#000" },
        },
      ],
    };
    const first = await fetch(`${themesUrl()}/migrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.ok).toBe(true);
    const firstState = await first.json();
    expect(firstState.activeThemeId).toBe("custom-legacy-1");
    expect(firstState.customThemes.map((entry: { id: string }) => entry.id)).toEqual([
      "custom-legacy-1",
    ]);
    expect(firstState.initialized).toBe(true);

    // A second migrate (another tab) must not clobber the now-initialized store.
    const second = await fetch(`${themesUrl()}/migrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        activeThemeId: "dracula",
        customThemes: [{ id: "custom-other", name: "Other", source: "imported", colors: {} }],
      }),
    });
    const secondState = await second.json();
    expect(secondState.activeThemeId).toBe("custom-legacy-1");
    expect(secondState.customThemes.map((entry: { id: string }) => entry.id)).toEqual([
      "custom-legacy-1",
    ]);
  });

  it("rejects an invalid import body with 400 invalid_body", async () => {
    const response = await fetch(`${themesUrl()}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: 123 }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_body");
  });
});
