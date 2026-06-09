import { describe, expect, it } from "vite-plus/test";
import { parseOscTitleFromChunk } from "../../src/utils/parse-osc-title.js";

const ESC = "\x1b";
const BEL = "\x07";
const ST = `${ESC}\\`;

describe("parseOscTitleFromChunk", () => {
  it("returns null when no OSC 0/2 sequences are present", () => {
    expect(parseOscTitleFromChunk("hello world")).toBeNull();
    expect(parseOscTitleFromChunk(`${ESC}]7;file://localhost/Users/user${BEL}`)).toBeNull();
  });

  it("parses OSC 0 with BEL terminator", () => {
    expect(parseOscTitleFromChunk(`${ESC}]0;my title${BEL}`)).toBe("my title");
  });

  it("parses OSC 2 with BEL terminator", () => {
    expect(parseOscTitleFromChunk(`${ESC}]2;my title${BEL}`)).toBe("my title");
  });

  it("parses OSC 0 with ST terminator", () => {
    expect(parseOscTitleFromChunk(`${ESC}]0;my title${ST}`)).toBe("my title");
  });

  it("parses OSC 2 with ST terminator", () => {
    expect(parseOscTitleFromChunk(`${ESC}]2;my title${ST}`)).toBe("my title");
  });

  it("returns the last title when multiple are present", () => {
    const chunk = `${ESC}]0;first${BEL}${ESC}]2;second${BEL}`;
    expect(parseOscTitleFromChunk(chunk)).toBe("second");
  });

  it("works when the title is surrounded by other output", () => {
    const chunk = `before${ESC}]0;vim foo.ts${BEL}after`;
    expect(parseOscTitleFromChunk(chunk)).toBe("vim foo.ts");
  });

  it("ignores empty titles", () => {
    expect(parseOscTitleFromChunk(`${ESC}]0;${BEL}`)).toBeNull();
    expect(parseOscTitleFromChunk(`${ESC}]2;${BEL}`)).toBeNull();
  });

  it("handles titles with special characters", () => {
    expect(parseOscTitleFromChunk(`${ESC}]0;user@host:~/projects${BEL}`)).toBe(
      "user@host:~/projects",
    );
  });
});
