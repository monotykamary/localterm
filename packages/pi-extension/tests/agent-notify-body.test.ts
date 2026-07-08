import { describe, expect, it } from "vite-plus/test";
import { formatAgentEndBody } from "../src/utils/agent-notify-body.js";

describe("formatAgentEndBody", () => {
  it("formats sub-minute durations as seconds with one decimal", () => {
    expect(formatAgentEndBody(12_500)).toBe("pi finished (12.5s)");
  });

  it("does not round a just-under-a-minute turn up to 60.0s", () => {
    expect(formatAgentEndBody(59_999)).toBe("pi finished (59.9s)");
  });

  it("formats minute-plus durations as minutes and seconds", () => {
    expect(formatAgentEndBody(60_000)).toBe("pi finished (1m 0s)");
    expect(formatAgentEndBody(153_000)).toBe("pi finished (2m 33s)");
  });

  it("includes the session name when provided", () => {
    expect(formatAgentEndBody(12_500, "refactor auth")).toBe("pi finished: refactor auth (12.5s)");
  });

  it("omits the session name when undefined", () => {
    expect(formatAgentEndBody(12_500, undefined)).toBe("pi finished (12.5s)");
  });
});
