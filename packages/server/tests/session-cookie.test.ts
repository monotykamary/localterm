import { describe, expect, it } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import {
  generateAuthSecret,
  loadOrCreateAuthSecret,
  readSessionIdentity,
  setSessionCookie,
  signSessionToken,
  verifySessionToken,
} from "../src/identity/session-cookie.js";

describe("session cookie signing", () => {
  const secret = "test-secret";

  it("verifies a token it signed", () => {
    expect(verifySessionToken(secret, signSessionToken(secret, "alice"))).toBe("alice");
  });

  it("rejects a token signed with a different secret", () => {
    expect(verifySessionToken("other-secret", signSessionToken(secret, "alice"))).toBeNull();
  });

  it("rejects a tampered token", () => {
    const token = signSessionToken(secret, "alice");
    const tampered = `${token.slice(0, -2)}xx`;
    expect(verifySessionToken(secret, tampered)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifySessionToken(secret, "not-a-token")).toBeNull();
    expect(verifySessionToken(secret, "")).toBeNull();
    expect(verifySessionToken(secret, "abc.def.ghi")).toBeNull();
  });
});

describe("session cookie round-trip", () => {
  const secret = "round-trip-secret";

  it("set then read resolves the user from the cookie", async () => {
    const app = new Hono();
    app.get("/set", (c) => {
      setSessionCookie(c, secret, "bob");
      return c.text("ok");
    });
    let captured: string | null = "__unset__";
    app.get("/read", (c) => {
      captured = readSessionIdentity(c, secret)?.user ?? null;
      return c.text("ok");
    });

    const setRes = await app.request("/set");
    const setCookie = setRes.headers.get("set-cookie");
    if (!setCookie) throw new Error("no set-cookie");
    expect(setCookie).toContain("HttpOnly");

    await app.request("/read", { headers: { cookie: setCookie.split(";")[0] } });
    expect(captured).toBe("bob");
  });

  it("read with no cookie resolves to null", async () => {
    const app = new Hono();
    let captured: string | null = "__unset__";
    app.get("/read", (c) => {
      captured = readSessionIdentity(c, secret)?.user ?? null;
      return c.text("ok");
    });
    await app.request("/read");
    expect(captured).toBeNull();
  });
});

describe("auth secret", () => {
  it("generateAuthSecret is non-empty and unique", () => {
    expect(generateAuthSecret()).toBeTruthy();
    expect(generateAuthSecret()).not.toBe(generateAuthSecret());
  });

  it("loadOrCreateAuthSecret generates, persists, and reloads the same value", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-auth-"));
    try {
      const file = path.join(dir, "auth-secret");
      const first = loadOrCreateAuthSecret(file);
      const second = loadOrCreateAuthSecret(file);
      expect(second).toBe(first);
      expect(fs.readFileSync(file, "utf8")).toBe(first);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
