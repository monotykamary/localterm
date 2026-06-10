import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vite-plus/test";
import { parsePortOption } from "../../src/utils/parse-port-option.js";

describe("parsePortOption", () => {
  it("parses a valid integer port", () => {
    expect(parsePortOption("3417")).toBe(3417);
  });

  it("accepts the upper boundary port", () => {
    expect(parsePortOption("65535")).toBe(65535);
  });

  it("rejects port 0 (ephemeral port not supported)", () => {
    expect(() => parsePortOption("0")).toThrow(InvalidArgumentError);
  });

  it("rejects non-numeric input rather than silently coercing to NaN", () => {
    expect(() => parsePortOption("abc")).toThrow(InvalidArgumentError);
    expect(() => parsePortOption("80a")).toThrow(InvalidArgumentError);
    expect(() => parsePortOption("")).toThrow(InvalidArgumentError);
  });

  it("rejects negative ports", () => {
    expect(() => parsePortOption("-1")).toThrow(InvalidArgumentError);
  });

  it("rejects ports above the TCP range", () => {
    expect(() => parsePortOption("65536")).toThrow(InvalidArgumentError);
    expect(() => parsePortOption("99999")).toThrow(InvalidArgumentError);
  });

  it("rejects floats with a fractional part", () => {
    expect(() => parsePortOption("3417.5")).toThrow(InvalidArgumentError);
  });
});
