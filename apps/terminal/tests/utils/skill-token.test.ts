import { describe, expect, it } from "vite-plus/test";
import { computeSkillToken } from "../../src/utils/skill-token";

describe("computeSkillToken", () => {
  it("detects a slash at the start of the text", () => {
    expect(computeSkillToken("/br", 3)).toEqual({ slashIndex: 0, endIndex: 3, query: "br" });
  });

  it("ignores a slash that isn't at the very start of the text", () => {
    expect(computeSkillToken("hi /br", 6)).toBeNull();
  });

  it("ignores a slash at the start of a later line", () => {
    expect(computeSkillToken("a\n/b", 4)).toBeNull();
  });

  it("ignores a slash preceded by a non-space character", () => {
    expect(computeSkillToken("a/b", 3)).toBeNull();
  });

  it("ignores a slash when the cursor moved into whitespace past it", () => {
    expect(computeSkillToken("/br ", 4)).toBeNull();
  });

  it("ignores a slash when the cursor sits before it", () => {
    expect(computeSkillToken("/br", 0)).toBeNull();
  });

  it("strips a leading skill: prefix from the query", () => {
    expect(computeSkillToken("/skill:brave", 12)).toEqual({
      slashIndex: 0,
      endIndex: 12,
      query: "brave",
    });
  });

  it("extends the token span to the end of the non-whitespace run even when the cursor is mid-token", () => {
    expect(computeSkillToken("/brave rest", 3)).toEqual({
      slashIndex: 0,
      endIndex: 6,
      query: "brave",
    });
  });

  it("returns null when there is no slash", () => {
    expect(computeSkillToken("hello", 5)).toBeNull();
  });
});
