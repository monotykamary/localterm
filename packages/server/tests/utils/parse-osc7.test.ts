import { describe, expect, it } from "vite-plus/test";
import { parseOsc7FromChunk } from "../../src/utils/parse-osc7.js";

const ESC = "\x1b";
const BEL = "\x07";
const ST = `${ESC}\\`;

describe("parseOsc7FromChunk", () => {
  it("returns null when no OSC 7 sequences are present", () => {
    expect(parseOsc7FromChunk("hello world")).toBeNull();
    expect(parseOsc7FromChunk(`${ESC}]0;my title${BEL}`)).toBeNull();
  });

  it("parses OSC 7 with BEL terminator", () => {
    expect(parseOsc7FromChunk(`${ESC}]7;file://localhost/Users/user${BEL}`)).toBe("/Users/user");
  });

  it("parses OSC 7 with ST terminator", () => {
    expect(parseOsc7FromChunk(`${ESC}]7;file://localhost/Users/user${ST}`)).toBe("/Users/user");
  });

  it("returns the last path when multiple OSC 7 sequences are present", () => {
    const chunk = `${ESC}]7;file://localhost/Users/first${BEL}${ESC}]7;file://localhost/Users/second${BEL}`;
    expect(parseOsc7FromChunk(chunk)).toBe("/Users/second");
  });

  it("works when the sequence is surrounded by other output", () => {
    const chunk = `some output${ESC}]7;file://localhost/home/user/project${BEL}more output`;
    expect(parseOsc7FromChunk(chunk)).toBe("/home/user/project");
  });

  it("handles URL-encoded paths", () => {
    expect(parseOsc7FromChunk(`${ESC}]7;file://localhost/Users/my%20dir${BEL}`)).toBe(
      "/Users/my dir",
    );
  });

  it("handles deeply nested paths", () => {
    expect(
      parseOsc7FromChunk(`${ESC}]7;file://localhost/Users/user/projects/my-app/src${BEL}`),
    ).toBe("/Users/user/projects/my-app/src");
  });

  it("returns null for malformed URLs", () => {
    expect(parseOsc7FromChunk(`${ESC}]7;not-a-url${BEL}`)).toBeNull();
  });

  it("handles sequences split across chunks via pendingParse", () => {
    const partial = `some output${ESC}]7;file://localhost/Us`;
    const remainder = `ers/user${BEL}more`;
    expect(parseOsc7FromChunk(partial + remainder)).toBe("/Users/user");
  });
});
