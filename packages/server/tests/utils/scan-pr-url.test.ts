import { describe, expect, it } from "vite-plus/test";
import { scanPrUrls } from "../../src/utils/scan-pr-url.js";

const URL = "https://github.com/foo/bar/pull/123";

describe("scanPrUrls", () => {
  it("returns an empty array when there is no PR URL", () => {
    expect(scanPrUrls("no url here")).toEqual([]);
    expect(scanPrUrls("https://example.com/foo/bar")).toEqual([]);
  });

  it("finds a single bare PR URL", () => {
    expect(scanPrUrls(`Created ${URL}`)).toEqual([URL]);
  });

  it("strips ANSI escapes wrapping the URL (a TUI colors it)", () => {
    const colored = `PR: \x1b[34m${URL}\x1b[0m done`;
    expect(scanPrUrls(colored)).toEqual([URL]);
  });

  it("strips a full OSC sequence so a pr-created marker is not double-counted", () => {
    // The OSC payload carries the URL, but layer A owns it; layer B must not
    // re-scan it (the gh wrapper also replays the URL as plain text, which the
    // scanner picks up — the OSC itself stays opaque).
    const chunk = `\x1b]7777;pr-created;${URL}\x07 trailing`;
    expect(scanPrUrls(chunk)).toEqual([]);
  });

  it("returns distinct URLs in first-appearance order", () => {
    const a = "https://github.com/foo/bar/pull/1";
    const b = "https://github.com/foo/bar/pull/2";
    expect(scanPrUrls(`${a} and ${b} and ${a}`)).toEqual([a, b]);
  });
});
