import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  deleteTheme,
  fetchThemes,
  importTheme,
  migrateThemes,
  setActiveTheme,
} from "../../src/utils/fetch-themes";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("fetch-themes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchThemes returns the parsed state on 200", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        activeThemeId: "dracula",
        customThemes: [{ id: "custom-1", name: "Mine", source: "imported", colors: {} }],
        initialized: true,
      }),
    );
    const state = await fetchThemes();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/themes$/);
    expect(state).toEqual({
      activeThemeId: "dracula",
      customThemes: [{ id: "custom-1", name: "Mine", source: "imported", colors: {} }],
      initialized: true,
    });
  });

  it("fetchThemes returns null on a non-2xx (daemon down / 503)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    expect(await fetchThemes()).toBeNull();
  });

  it("fetchThemes returns null on an unparseable body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ wrong: "shape" }));
    expect(await fetchThemes()).toBeNull();
  });

  it("importTheme maps a 201 to { theme } and a 400 to { error }", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ theme: { id: "custom-1", name: "x", source: "imported", colors: {} } }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: "invalid_theme", message: "Not valid JSON" }, 400),
      );
    const ok = await importTheme("{...}", "x.json");
    expect("theme" in ok).toBe(true);

    const err = await importTheme("{not json", "x.json");
    expect("error" in err).toBe(true);
    if ("error" in err) expect(err.error).toBe("Not valid JSON");
  });

  it("importTheme reports capacity on 409", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "capacity" }, 409));
    const result = await importTheme("{}", "x.json");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/many/);
  });

  it("setActiveTheme PUTs the id and returns true on 200", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ activeThemeId: "dracula" }));
    expect(await setActiveTheme("dracula")).toBe(true);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/themes\/active$/);
    expect(fetchSpy.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "PUT" }));
  });

  it("deleteTheme returns the new active id on 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ activeThemeId: "vesper" }));
    expect(await deleteTheme("custom-1")).toBe("vesper");
  });

  it("deleteTheme returns null on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    expect(await deleteTheme("custom-1")).toBeNull();
  });

  it("migrateThemes posts the browser state and returns the result", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ activeThemeId: "dracula", customThemes: [], initialized: true }),
      );
    const state = await migrateThemes("dracula", []);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/themes\/migrate$/);
    expect(fetchSpy.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(state).toEqual({ activeThemeId: "dracula", customThemes: [], initialized: true });
  });
});
