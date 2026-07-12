import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { fetchFonts, migrateFonts, updateFonts } from "../../src/utils/fetch-fonts";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const fontsState = {
  activeFontId: "jetbrains-mono",
  customFontFamily: "JetBrainsMono Nerd Font Mono",
  nerdFontEnabled: true,
  ligaturesEnabled: false,
  initialized: true,
};

describe("fetch-fonts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchFonts returns the parsed state on 200", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(fontsState));
    const state = await fetchFonts();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/fonts$/);
    expect(state).toEqual(fontsState);
  });

  it("fetchFonts returns null on a non-2xx (daemon down / 503)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    expect(await fetchFonts()).toBeNull();
  });

  it("fetchFonts returns null on an unparseable body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ wrong: "shape" }));
    expect(await fetchFonts()).toBeNull();
  });

  it("updateFonts PUTs the patch and returns the reconciled state", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(fontsState));
    const state = await updateFonts({ nerdFontEnabled: true });
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/fonts$/);
    expect(fetchSpy.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "PUT" }));
    expect(state).toEqual(fontsState);
  });

  it("updateFonts returns null on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    expect(await updateFonts({ activeFontId: "custom" })).toBeNull();
  });

  it("migrateFonts posts the legacy state and returns the result", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(fontsState));
    const state = await migrateFonts({
      activeFontId: "jetbrains-mono",
      customFontFamily: "JetBrainsMono Nerd Font Mono",
      nerdFontEnabled: true,
      ligaturesEnabled: false,
    });
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/fonts\/migrate$/);
    expect(fetchSpy.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(state).toEqual(fontsState);
  });

  it("migrateFonts returns null on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    expect(
      await migrateFonts({
        activeFontId: "geist-mono",
        customFontFamily: "",
        nerdFontEnabled: false,
        ligaturesEnabled: false,
      }),
    ).toBeNull();
  });
});
