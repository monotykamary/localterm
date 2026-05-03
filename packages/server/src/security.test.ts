import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { isLoopbackHost, loopbackMiddleware } from "./security.js";

const app = new Hono();
app.use("*", loopbackMiddleware);
app.get("/probe", (context) => context.json({ ok: true }));

const probe = (headers: Record<string, string>) =>
  app.request("http://localhost/probe", { headers });

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
