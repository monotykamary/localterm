import { describe, expect, it } from "vite-plus/test";
import { scrubEnv } from "../src/utils/scrub-env.js";

describe("scrubEnv", () => {
  it("returns the input unchanged when the strip set is empty", () => {
    const env: NodeJS.ProcessEnv = { FOO: "1", BAR: "2" };
    expect(scrubEnv(env, new Set())).toBe(env);
  });

  it("deletes only the named keys that are present", () => {
    const env: NodeJS.ProcessEnv = { KEEP: "yes", SECRET: "no", OTHER: "x" };
    const result = scrubEnv(env, new Set(["SECRET", "MISSING"]));
    expect(result).toEqual({ KEEP: "yes", OTHER: "x" });
    expect(env.SECRET).toBe("no");
  });

  it("drops an undefined-valued entry", () => {
    const env: NodeJS.ProcessEnv = { KEEP: "yes", MAYBE: undefined };
    const result = scrubEnv(env, new Set(["MAYBE"]));
    expect("MAYBE" in result).toBe(false);
  });

  it("returns a distinct object (does not mutate the input) when stripping", () => {
    const env: NodeJS.ProcessEnv = { KEEP: "yes", SECRET: "no" };
    const result = scrubEnv(env, new Set(["SECRET"]));
    expect(result).not.toBe(env);
    expect(env.SECRET).toBe("no");
  });
});
