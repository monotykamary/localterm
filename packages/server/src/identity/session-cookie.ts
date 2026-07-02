import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { AUTH_COOKIE_MAX_AGE_SECONDS, AUTH_COOKIE_NAME, AUTH_SECRET_BYTES } from "../constants.js";
import type { Identity } from "./types.js";

// A session cookie is `base64url(payload).base64url(hmac)`, where the payload
// is `{ sub, exp }` (epoch-ms). HMAC-SHA256 over the payload segment with a
// persisted secret; a tampered token fails the constant-time compare. This is
// the seamless-UX piece: after a passkey login the browser keeps this cookie,
// so every new tab (and the WS upgrade) re-authenticates with no prompt.
interface SessionPayload {
  sub: string;
  exp: number;
}

const sign = (secret: string, data: string): string =>
  createHmac("sha256", secret).update(data).digest("base64url");

export const generateAuthSecret = (): string =>
  randomBytes(AUTH_SECRET_BYTES).toString("base64url");

// Read the persisted HMAC secret, generating + persisting a fresh one on the
// first run. Losing this file invalidates every live session (users re-log in),
// which is the correct failure mode — never silently reuse a weak/absent key.
export const loadOrCreateAuthSecret = (filePath: string): string => {
  try {
    const existing = fs.readFileSync(filePath, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* no file yet */
  }
  const secret = generateAuthSecret();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, secret, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  return secret;
};

export const signSessionToken = (secret: string, user: string): string => {
  const payload: SessionPayload = {
    sub: user,
    exp: Date.now() + AUTH_COOKIE_MAX_AGE_SECONDS * 1000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(secret, data)}`;
};

export const verifySessionToken = (secret: string, token: string): string | null => {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(secret, data);
  const sigBytes = Buffer.from(sig);
  const expectedBytes = Buffer.from(expected);
  if (sigBytes.length !== expectedBytes.length || !timingSafeEqual(sigBytes, expectedBytes)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload?.sub !== "string" || typeof payload?.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
};

// A cookie is `Secure` only when the browser's own origin is https — read from
// the `Origin` header the browser sends on the fetch (most reliable), with the
// request URL and `x-forwarded-proto` as fallbacks for a TLS-terminating proxy.
// On plain loopback HTTP we omit `Secure` (the cookie still works; loopback is
// the trusted surface) so the cookie is settable on every localterm surface.
const isSecureRequest = (context: Context): boolean => {
  const origin = context.req.header("origin");
  if (origin?.startsWith("https://")) return true;
  if (context.req.url.startsWith("https://")) return true;
  return context.req.header("x-forwarded-proto")?.includes("https") === true;
};

const cookieOptions = (context: Context, maxAge: number) => ({
  httpOnly: true,
  sameSite: "Lax" as const,
  path: "/",
  maxAge,
  secure: isSecureRequest(context),
});

export const setSessionCookie = (context: Context, secret: string, user: string): void => {
  setCookie(
    context,
    AUTH_COOKIE_NAME,
    signSessionToken(secret, user),
    cookieOptions(context, AUTH_COOKIE_MAX_AGE_SECONDS),
  );
};

export const clearSessionCookie = (context: Context): void => {
  setCookie(context, AUTH_COOKIE_NAME, "", cookieOptions(context, 0));
};

export const readSessionIdentity = (context: Context, secret: string): Identity | null => {
  const token = getCookie(context, AUTH_COOKIE_NAME);
  if (!token) return null;
  const sub = verifySessionToken(secret, token);
  return sub ? { user: sub } : null;
};
