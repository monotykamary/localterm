import { describe, expect, it } from "vite-plus/test";
import { Hono } from "hono";
import {
  createNetworkPolicyMiddleware,
  isAllowedSourceIp,
  isLoopbackHost,
  isPrivateHost,
  loopbackMiddleware,
} from "../src/security.js";

const loopbackApp = new Hono();
loopbackApp.use("*", loopbackMiddleware);
loopbackApp.get("/probe", (context) => context.json({ ok: true }));

const probe = (headers: Record<string, string>) =>
  loopbackApp.request("http://localhost/probe", { headers });

describe("isLoopbackHost", () => {
  it("accepts loopback addresses", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("accepts *.localhost (RFC 6761, always resolves to loopback)", () => {
    expect(isLoopbackHost("localterm.localhost")).toBe(true);
    expect(isLoopbackHost("api.myapp.localhost")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
    expect(isLoopbackHost("evil.example.com")).toBe(false);
    expect(isLoopbackHost("notlocalhost")).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
  });
});

describe("loopbackMiddleware", () => {
  it("allows requests with loopback Host", async () => {
    const response = await probe({ host: "127.0.0.1:3417" });
    expect(response.status).toBe(200);
  });

  it("allows IPv6 loopback", async () => {
    const response = await probe({ host: "[::1]:3417" });
    expect(response.status).toBe(200);
  });

  it("normalizes bare IPv6 loopback Host (no brackets)", async () => {
    const response = await probe({ host: "::1" });
    expect(response.status).toBe(200);
  });

  it("allows localhost with port", async () => {
    const response = await probe({ host: "localhost:3417" });
    expect(response.status).toBe(200);
  });

  it("allows *.localhost with port", async () => {
    const response = await probe({ host: "localterm.localhost:3417" });
    expect(response.status).toBe(200);
  });

  it("allows [::1] with port", async () => {
    const response = await probe({ host: "[::1]:3417" });
    expect(response.status).toBe(200);
  });

  it("rejects forged Host header (DNS rebind)", async () => {
    const response = await probe({ host: "evil.example.com" });
    expect(response.status).toBe(403);
  });

  it("allows reverse-proxied *.localhost Host header", async () => {
    const response = await probe({
      host: "localterm.localhost",
      origin: "https://localterm.localhost",
    });
    expect(response.status).toBe(200);
  });

  it("rejects cross-origin requests", async () => {
    const response = await probe({
      host: "127.0.0.1:3417",
      origin: "https://evil.example.com",
    });
    expect(response.status).toBe(403);
  });

  it("allows same-origin loopback requests", async () => {
    const response = await probe({
      host: "127.0.0.1:3417",
      origin: "http://127.0.0.1:3417",
    });
    expect(response.status).toBe(200);
  });

  it("allows null origin (non-CORS contexts)", async () => {
    const response = await probe({ host: "127.0.0.1:3417" });
    expect(response.status).toBe(200);
  });
});

describe("isPrivateHost", () => {
  it("accepts loopback addresses", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("::1")).toBe(true);
  });

  it("accepts RFC 1918 private ranges", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
  });

  it("accepts CGNAT / Tailscale range", () => {
    expect(isPrivateHost("100.64.0.1")).toBe(true);
    expect(isPrivateHost("100.127.255.255")).toBe(true);
  });

  it("accepts link-local addresses", () => {
    expect(isPrivateHost("169.254.0.1")).toBe(true);
  });

  it("accepts IPv6 private addresses", () => {
    expect(isPrivateHost("fc00::1")).toBe(true);
    expect(isPrivateHost("fd12:3456::1")).toBe(true);
    expect(isPrivateHost("fe80::1")).toBe(true);
  });

  it("rejects public IPs", () => {
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("1.2.3.4")).toBe(false);
    expect(isPrivateHost("203.0.113.1")).toBe(false);
  });

  it("rejects hostnames that are not .localhost", () => {
    expect(isPrivateHost("evil.example.com")).toBe(false);
    expect(isPrivateHost("myserver.local")).toBe(false);
  });

  it("rejects public IPs outside Tailscale CGNAT range", () => {
    expect(isPrivateHost("100.63.255.255")).toBe(false);
    expect(isPrivateHost("100.128.0.1")).toBe(false);
  });

  it("accepts bracketed IPv6 private addresses", () => {
    expect(isPrivateHost("[fc00::1]")).toBe(true);
    expect(isPrivateHost("[fd12:3456::1]")).toBe(true);
  });
});

describe("createNetworkPolicyMiddleware (loopback bind)", () => {
  const app = new Hono();
  app.use("*", createNetworkPolicyMiddleware("127.0.0.1"));
  app.get("/probe", (context) => context.json({ ok: true }));

  const probe = (headers: Record<string, string>) =>
    app.request("http://127.0.0.1/probe", { headers });

  it("allows loopback Host", async () => {
    const response = await probe({ host: "127.0.0.1:3417" });
    expect(response.status).toBe(200);
  });

  it("rejects non-loopback Host even if private", async () => {
    const response = await probe({ host: "192.168.1.1:3417" });
    expect(response.status).toBe(403);
  });

  it("allows *.localhost Host", async () => {
    const response = await probe({ host: "localterm.localhost" });
    expect(response.status).toBe(200);
  });

  it("rejects cross-origin from public site", async () => {
    const response = await probe({
      host: "127.0.0.1:3417",
      origin: "https://evil.example.com",
    });
    expect(response.status).toBe(403);
  });
});

describe("createNetworkPolicyMiddleware (0.0.0.0 bind)", () => {
  const app = new Hono();
  app.use("*", createNetworkPolicyMiddleware("0.0.0.0"));
  app.get("/probe", (context) => context.json({ ok: true }));

  const probe = (headers: Record<string, string>) =>
    app.request("http://100.64.0.1/probe", { headers });

  it("allows loopback Host", async () => {
    const response = await probe({ host: "127.0.0.1:3417" });
    expect(response.status).toBe(200);
  });

  it("allows private Host (Tailscale)", async () => {
    const response = await probe({ host: "100.64.0.1:3417" });
    expect(response.status).toBe(200);
  });

  it("allows private Host (RFC 1918)", async () => {
    const response = await probe({ host: "192.168.1.1:3417" });
    expect(response.status).toBe(200);
  });

  it("allows *.localhost Host", async () => {
    const response = await probe({ host: "localterm.localhost" });
    expect(response.status).toBe(200);
  });

  it("rejects public Host (DNS rebinding)", async () => {
    const response = await probe({ host: "evil.example.com" });
    expect(response.status).toBe(403);
  });

  it("rejects cross-origin from public site", async () => {
    const response = await probe({
      host: "127.0.0.1:3417",
      origin: "https://evil.example.com",
    });
    expect(response.status).toBe(403);
  });

  it("allows same-origin from private network", async () => {
    const response = await probe({
      host: "100.64.0.1:3417",
      origin: "http://100.64.0.1:3417",
    });
    expect(response.status).toBe(200);
  });
});

describe("isAllowedSourceIp", () => {
  it("always allows connections when bound to loopback", () => {
    expect(isAllowedSourceIp("8.8.8.8", "127.0.0.1")).toBe(true);
    expect(isAllowedSourceIp("192.168.1.1", "127.0.0.1")).toBe(true);
  });

  it("allows loopback source when bound to 0.0.0.0", () => {
    expect(isAllowedSourceIp("127.0.0.1", "0.0.0.0")).toBe(true);
    expect(isAllowedSourceIp("::1", "0.0.0.0")).toBe(true);
  });

  it("allows Tailscale CGNAT source when bound to 0.0.0.0", () => {
    expect(isAllowedSourceIp("100.64.0.1", "0.0.0.0")).toBe(true);
    expect(isAllowedSourceIp("100.127.255.255", "0.0.0.0")).toBe(true);
  });

  it("allows RFC 1918 source when bound to 0.0.0.0", () => {
    expect(isAllowedSourceIp("10.0.0.1", "0.0.0.0")).toBe(true);
    expect(isAllowedSourceIp("172.16.0.1", "0.0.0.0")).toBe(true);
    expect(isAllowedSourceIp("192.168.1.1", "0.0.0.0")).toBe(true);
  });

  it("rejects public source when bound to 0.0.0.0", () => {
    expect(isAllowedSourceIp("8.8.8.8", "0.0.0.0")).toBe(false);
    expect(isAllowedSourceIp("203.0.113.1", "0.0.0.0")).toBe(false);
  });

  it("handles IPv6-mapped IPv4 addresses", () => {
    expect(isAllowedSourceIp("::ffff:127.0.0.1", "0.0.0.0")).toBe(true);
  });

  it("strips IPv6 zone identifiers", () => {
    expect(isAllowedSourceIp("fe80::1%en0", "0.0.0.0")).toBe(true);
  });
});
