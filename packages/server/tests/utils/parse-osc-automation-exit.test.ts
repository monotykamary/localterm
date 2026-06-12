import { describe, expect, it } from "vite-plus/test";
import { parseOscAutomationExitFromChunk } from "../../src/utils/parse-osc-automation-exit.js";

describe("parseOscAutomationExitFromChunk", () => {
  it("parses a BEL-terminated exit code", () => {
    expect(parseOscAutomationExitFromChunk("\x1b]7777;automation-exit;0\x07")).toBe(0);
    expect(parseOscAutomationExitFromChunk("\x1b]7777;automation-exit;1\x07")).toBe(1);
    expect(parseOscAutomationExitFromChunk("\x1b]7777;automation-exit;130\x07")).toBe(130);
  });

  it("parses an ST-terminated exit code", () => {
    expect(parseOscAutomationExitFromChunk("\x1b]7777;automation-exit;2\x1b\\")).toBe(2);
  });

  it("parses the sequence embedded in surrounding output", () => {
    const chunk = "build done\r\n\x1b]7777;automation-exit;0\x07prompt$ ";
    expect(parseOscAutomationExitFromChunk(chunk)).toBe(0);
  });

  it("ignores the git-dirty sequence", () => {
    expect(parseOscAutomationExitFromChunk("\x1b]7777;git-dirty\x07")).toBeNull();
  });

  it("returns null for an unterminated sequence", () => {
    expect(parseOscAutomationExitFromChunk("\x1b]7777;automation-exit;0")).toBeNull();
  });

  it("returns null for non-numeric or oversized payloads", () => {
    expect(parseOscAutomationExitFromChunk("\x1b]7777;automation-exit;abc\x07")).toBeNull();
    expect(parseOscAutomationExitFromChunk("\x1b]7777;automation-exit;\x07")).toBeNull();
    expect(parseOscAutomationExitFromChunk("\x1b]7777;automation-exit;12345\x07")).toBeNull();
  });

  it("skips a malformed occurrence and parses a later valid one", () => {
    const chunk = "\x1b]7777;automation-exit;x\x07noise\x1b]7777;automation-exit;7\x07";
    expect(parseOscAutomationExitFromChunk(chunk)).toBe(7);
  });
});
