import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";
import { DEFAULT_TERMINAL_FONT_ID } from "../src/terminal-fonts.js";

describe("/api/fonts", () => {
  let stateDirectory: string;
  let server: RunningServer;

  beforeEach(async () => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-fonts-api-"));
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

  const fontsUrl = () => `http://127.0.0.1:${server.port}/api/fonts`;

  it("GET returns the default state and is uninitialized before any write", async () => {
    const response = await fetch(fontsUrl());
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body).toMatchObject({
      activeFontId: DEFAULT_TERMINAL_FONT_ID,
      customFontFamily: "",
      nerdFontEnabled: false,
      ligaturesEnabled: false,
      initialized: false,
    });
  });

  it("PUT updates the active font id and marks the store initialized", async () => {
    const response = await fetch(fontsUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeFontId: "jetbrains-mono" }),
    });
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body.activeFontId).toBe("jetbrains-mono");
    expect(body.initialized).toBe(true);

    // A follow-up GET reflects the persisted state.
    const state = await (await fetch(fontsUrl())).json();
    expect(state.activeFontId).toBe("jetbrains-mono");
    expect(state.initialized).toBe(true);
  });

  it("PUT accepts the custom pseudo-id as the active font", async () => {
    const response = await fetch(fontsUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeFontId: "custom", customFontFamily: "MesloLGS NF" }),
    });
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body.activeFontId).toBe("custom");
    expect(body.customFontFamily).toBe("MesloLGS NF");
  });

  it("PUT toggles nerd font and ligatures independently", async () => {
    await fetch(fontsUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nerdFontEnabled: true }),
    });
    await fetch(fontsUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ligaturesEnabled: true }),
    });
    const state = await (await fetch(fontsUrl())).json();
    expect(state.nerdFontEnabled).toBe(true);
    expect(state.ligaturesEnabled).toBe(true);
  });

  it("PUT rejects an unknown active font id with 404", async () => {
    const response = await fetch(fontsUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeFontId: "totally-made-up" }),
    });
    expect(response.status).toBe(404);
  });

  it("PUT rejects an empty update with 400 invalid_body", async () => {
    const response = await fetch(fontsUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_body");
  });

  it("PUT rejects an unknown field with 400 invalid_body (strict)", async () => {
    const response = await fetch(fontsUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bogus: true }),
    });
    expect(response.status).toBe(400);
  });

  it("migrate adopts the browser's legacy state once, then no-ops", async () => {
    const payload = {
      activeFontId: "jetbrains-mono",
      customFontFamily: "JetBrainsMono Nerd Font Mono",
      nerdFontEnabled: true,
      ligaturesEnabled: false,
    };
    const first = await fetch(`${fontsUrl()}/migrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.ok).toBe(true);
    const firstState = await first.json();
    expect(firstState.activeFontId).toBe("jetbrains-mono");
    expect(firstState.customFontFamily).toBe("JetBrainsMono Nerd Font Mono");
    expect(firstState.nerdFontEnabled).toBe(true);
    expect(firstState.initialized).toBe(true);

    // A second migrate (another tab) must not clobber the now-initialized store.
    const second = await fetch(`${fontsUrl()}/migrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        activeFontId: "fira-code",
        customFontFamily: "Other",
        nerdFontEnabled: false,
        ligaturesEnabled: true,
      }),
    });
    const secondState = await second.json();
    expect(secondState.activeFontId).toBe("jetbrains-mono");
    expect(secondState.customFontFamily).toBe("JetBrainsMono Nerd Font Mono");
    expect(secondState.nerdFontEnabled).toBe(true);
  });

  it("migrate sanitizes a stale active id to the default", async () => {
    const first = await fetch(`${fontsUrl()}/migrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        activeFontId: "no-such-font",
        customFontFamily: "",
        nerdFontEnabled: false,
        ligaturesEnabled: false,
      }),
    });
    const state = await first.json();
    expect(state.activeFontId).toBe(DEFAULT_TERMINAL_FONT_ID);
    expect(state.initialized).toBe(true);
  });
});
