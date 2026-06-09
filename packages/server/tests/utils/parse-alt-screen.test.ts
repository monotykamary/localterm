import { describe, expect, it } from "vite-plus/test";
import { parseAltScreenFromChunk } from "../../src/utils/parse-alt-screen.js";

const ESC = "\x1b";
const DECSET_1049 = `${ESC}[?1049h`;
const DECRST_1049 = `${ESC}[?1049l`;

describe("parseAltScreenFromChunk", () => {
  it("returns null when no alt-screen sequences are present", () => {
    expect(parseAltScreenFromChunk("hello world")).toBeNull();
    expect(parseAltScreenFromChunk(`${ESC}[?47h`)).toBeNull();
  });

  it("returns true when DECSET 1049h is present (enter alt screen)", () => {
    expect(parseAltScreenFromChunk(DECSET_1049)).toBe(true);
  });

  it("returns false when DECRST 1049l is present (exit alt screen)", () => {
    expect(parseAltScreenFromChunk(DECRST_1049)).toBe(false);
  });

  it("detects enter surrounded by other output", () => {
    const chunk = `before${DECSET_1049}after`;
    expect(parseAltScreenFromChunk(chunk)).toBe(true);
  });

  it("detects exit surrounded by other output", () => {
    const chunk = `before${DECRST_1049}after`;
    expect(parseAltScreenFromChunk(chunk)).toBe(false);
  });

  it("last sequence wins when both enter and exit are present", () => {
    expect(parseAltScreenFromChunk(`${DECSET_1049}${DECRST_1049}`)).toBe(false);
    expect(parseAltScreenFromChunk(`${DECRST_1049}${DECSET_1049}`)).toBe(true);
  });

  it("handles multiple entries (last wins)", () => {
    expect(parseAltScreenFromChunk(`${DECSET_1049}${DECSET_1049}`)).toBe(true);
    expect(parseAltScreenFromChunk(`${DECSET_1049}${DECRST_1049}${DECSET_1049}`)).toBe(true);
    expect(parseAltScreenFromChunk(`${DECSET_1049}${DECRST_1049}${DECRST_1049}`)).toBe(false);
  });
});
