import { describe, expect, it } from "vite-plus/test";
import { parseOscNotificationsFromChunk } from "../../src/utils/parse-osc-notification.js";

const ESC = "\x1b";
const BEL = "\x07";
const ST = `${ESC}\\`;

describe("parseOscNotificationsFromChunk", () => {
  it("returns an empty array when no OSC 9 sequences are present", () => {
    expect(parseOscNotificationsFromChunk("hello world")).toEqual([]);
    expect(parseOscNotificationsFromChunk(`${ESC}]0;my title${BEL}`)).toEqual([]);
    expect(parseOscNotificationsFromChunk(`${ESC}]7;file://localhost/Users/user${BEL}`)).toEqual(
      [],
    );
  });

  it("parses OSC 9 with BEL terminator", () => {
    expect(parseOscNotificationsFromChunk(`${ESC}]9;Build complete${BEL}`)).toEqual([
      "Build complete",
    ]);
  });

  it("parses OSC 9 with ST terminator", () => {
    expect(parseOscNotificationsFromChunk(`${ESC}]9;Test passed${ST}`)).toEqual(["Test passed"]);
  });

  it("returns all notifications when multiple are present", () => {
    const chunk = `${ESC}]9;first${BEL}${ESC}]9;second${BEL}`;
    expect(parseOscNotificationsFromChunk(chunk)).toEqual(["first", "second"]);
  });

  it("works when the notification is surrounded by other output", () => {
    const chunk = `before${ESC}]9;Deploy done${BEL}after`;
    expect(parseOscNotificationsFromChunk(chunk)).toEqual(["Deploy done"]);
  });

  it("ignores empty notifications", () => {
    expect(parseOscNotificationsFromChunk(`${ESC}]9;${BEL}`)).toEqual([]);
  });

  it("does not confuse OSC 9 with OSC 0 or OSC 2", () => {
    const chunk = `${ESC}]0;window title${BEL}${ESC}]2;window title${BEL}`;
    expect(parseOscNotificationsFromChunk(chunk)).toEqual([]);
  });

  it("handles notifications with special characters", () => {
    expect(parseOscNotificationsFromChunk(`${ESC}]9;deploy/prod: ✓ done!${BEL}`)).toEqual([
      "deploy/prod: ✓ done!",
    ]);
  });
});
