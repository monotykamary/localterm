import { describe, expect, it } from "vite-plus/test";
import { getDirectUrl, getFriendlyUrl, getPortlessUrl } from "../src/constants.js";

describe("getFriendlyUrl", () => {
  it("formats the named-host URL with the bound port (works without portless via RFC 6761)", () => {
    expect(getFriendlyUrl(3417)).toBe("http://localterm.localhost:3417");
  });
});

describe("getPortlessUrl", () => {
  it("formats the portless named-host URL without a port", () => {
    expect(getPortlessUrl()).toBe("https://localterm.localhost");
  });
});

describe("getDirectUrl", () => {
  it("formats the literal loopback URL with the bound port", () => {
    expect(getDirectUrl(3417)).toBe("http://127.0.0.1:3417");
    expect(getDirectUrl(3417, "localhost")).toBe("http://localhost:3417");
  });
});
