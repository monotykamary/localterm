import { describe, expect, it } from "vite-plus/test";
import { trimTrailingLineBreaks } from "../../src/utils/trim-trailing-line-breaks.js";

describe("trimTrailingLineBreaks", () => {
  it("does not backtrack through a long interior CRLF run", () => {
    const value = `before${"\r\n".repeat(200)}prompt`;

    expect(trimTrailingLineBreaks(value)).toBe(value);
  });

  it("removes mixed trailing line breaks", () => {
    expect(trimTrailingLineBreaks("output\r\n\n\r")).toBe("output");
  });
});
