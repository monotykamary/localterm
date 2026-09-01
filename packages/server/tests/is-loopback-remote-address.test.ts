import { describe, expect, it } from "vite-plus/test";
import { isLoopbackRemoteAddress } from "../src/utils/is-loopback-remote-address.js";

describe("isLoopbackRemoteAddress", () => {
  it("accepts IPv4, IPv6, and IPv4-mapped loopback", () => {
    expect(isLoopbackRemoteAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("::1")).toBe(true);
    expect(isLoopbackRemoteAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects LAN and public addresses", () => {
    expect(isLoopbackRemoteAddress("192.168.1.4")).toBe(false);
    expect(isLoopbackRemoteAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackRemoteAddress("8.8.8.8")).toBe(false);
  });
});
