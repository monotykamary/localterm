import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  detectCapabilities,
  getCapabilities,
  resetCapabilitiesCache,
  setCapabilityOverrides,
} from "@earendil-works/pi-tui";
import { enableKittyImages } from "../extensions/kitty-images.js";

describe("enableKittyImages with Pi v1", () => {
  beforeEach(() => {
    for (const key of [
      "KITTY_WINDOW_ID",
      "TERM_PROGRAM",
      "GHOSTTY_RESOURCES_DIR",
      "WEZTERM_PANE",
      "ITERM_SESSION_ID",
      "TMUX",
      "PI_IMAGE_PROTOCOL",
      "PI_HYPERLINKS",
    ]) {
      vi.stubEnv(key, undefined);
    }
    vi.stubEnv("LOCALTERM", "1");
    vi.stubEnv("TERM", "xterm-256color");
    setCapabilityOverrides({});
    resetCapabilitiesCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setCapabilityOverrides({});
    resetCapabilitiesCache();
  });

  it("enables images for both fresh detection and an already-cached TUI", () => {
    getCapabilities();
    enableKittyImages();
    expect(getCapabilities()).toMatchObject({ images: "kitty", hyperlinks: true });
    expect(detectCapabilities()).toMatchObject({ images: "kitty", hyperlinks: true });
    expect(process.env.KITTY_WINDOW_ID).toBeUndefined();
    expect(process.env.WEZTERM_PANE).toBeUndefined();
  });

  it("resolves auto to LocalTerm capabilities", () => {
    vi.stubEnv("PI_IMAGE_PROTOCOL", "auto");
    vi.stubEnv("PI_HYPERLINKS", "auto");
    enableKittyImages();
    expect(detectCapabilities()).toMatchObject({ images: "kitty", hyperlinks: true });
  });

  it.each(["none", "iterm2"])("preserves the explicit %s image override", (protocol) => {
    vi.stubEnv("PI_IMAGE_PROTOCOL", protocol);
    vi.stubEnv("PI_HYPERLINKS", "0");
    enableKittyImages();
    expect(process.env.PI_IMAGE_PROTOCOL).toBe(protocol);
    expect(getCapabilities()).toMatchObject({
      images: protocol === "none" ? null : protocol,
      hyperlinks: false,
    });
  });

  it("does not override Pi terminal settings", () => {
    setCapabilityOverrides({ images: null, hyperlinks: false });
    enableKittyImages();
    expect(getCapabilities()).toMatchObject({ images: null, hyperlinks: false });
  });

  it("is inert outside LocalTerm", () => {
    vi.stubEnv("LOCALTERM", undefined);
    enableKittyImages();
    expect(process.env.PI_IMAGE_PROTOCOL).toBeUndefined();
    expect(process.env.PI_HYPERLINKS).toBeUndefined();
  });
});
