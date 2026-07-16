import { describe, expect, it } from "vite-plus/test";
import { toOpaqueHexColor } from "@/utils/to-opaque-hex-color";

describe("toOpaqueHexColor", () => {
  it.each([
    ["#abc", "#aabbcc"],
    ["#abcd", "#aabbcc"],
    ["#123456", "#123456"],
    ["#12345678", "#123456"],
  ])("normalizes %s to %s", (color, expected) => {
    expect(toOpaqueHexColor(color)).toBe(expected);
  });
});
