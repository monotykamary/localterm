import { describe, expect, it } from "vite-plus/test";
import { createSynchronizedOutputEndDetector } from "../../src/utils/create-synchronized-output-end-detector.js";

const END_SEQUENCE = "\x1b[?2026l";

describe("createSynchronizedOutputEndDetector", () => {
  it("detects a complete synchronized-output end sequence", () => {
    const detector = createSynchronizedOutputEndDetector();

    expect(detector.push(`before${END_SEQUENCE}after`)).toBe(true);
  });

  it("detects the sequence across every possible chunk boundary", () => {
    for (let splitIndex = 1; splitIndex < END_SEQUENCE.length; splitIndex += 1) {
      const detector = createSynchronizedOutputEndDetector();

      expect(detector.push(END_SEQUENCE.slice(0, splitIndex))).toBe(false);
      expect(detector.push(END_SEQUENCE.slice(splitIndex))).toBe(true);
    }
  });

  it("does not match ordinary output or an incomplete prefix", () => {
    const detector = createSynchronizedOutputEndDetector();

    expect(detector.push("plain output\x1b[?2026")).toBe(false);
    expect(detector.push("h more output")).toBe(false);
  });

  it("continues detecting later redraw boundaries", () => {
    const detector = createSynchronizedOutputEndDetector();

    expect(detector.push(END_SEQUENCE)).toBe(true);
    expect(detector.push("between")).toBe(false);
    expect(detector.push(END_SEQUENCE)).toBe(true);
  });
});
