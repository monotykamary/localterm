import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import {
  AUTH_CHALLENGE_TTL_MS,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_FORBIDDEN,
  IDENTITY_RP_NAME_DEFAULT,
  IDENTITY_USERNAME_MAX_LENGTH,
  IDENTITY_USERNAME_MIN_LENGTH,
} from "../constants.js";
import { CredentialStore } from "./credential-store.js";
import { UserStore } from "./user-store.js";
import type {
  Identity,
  IdentityProvider,
  IdentityProviderDeps,
  PasskeyIdentityConfig,
} from "./types.js";
import { clearSessionCookie, readSessionIdentity, setSessionCookie } from "./session-cookie.js";

// Ephemeral, in-memory challenge store with a short TTL. A challenge is issued
// with the options, single-use-consumed at verify (so a captured options blob
// can't be replayed), and swept lazily on each set. Lost on restart — fine, a
// challenge is only valid for minutes.
interface ChallengeEntry {
  kind: "register" | "login";
  expiresAt: number;
}

class ChallengeStore {
  private readonly challenges = new Map<string, ChallengeEntry>();

  set(challenge: string, kind: "register" | "login"): void {
    this.challenges.set(challenge, { kind, expiresAt: Date.now() + AUTH_CHALLENGE_TTL_MS });
    const now = Date.now();
    for (const [key, entry] of this.challenges) {
      if (entry.expiresAt < now) this.challenges.delete(key);
    }
  }

  // Single-use: delete on read, return true only if it matched the expected
  // kind and hadn't expired. A register challenge can't satisfy a login verify
  // (and vice versa), and a consumed challenge can't be replayed.
  consume(challenge: string, kind: "register" | "login"): boolean {
    const entry = this.challenges.get(challenge);
    this.challenges.delete(challenge);
    return entry?.kind === kind && entry.expiresAt >= Date.now();
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readBody = async (context: Context): Promise<Record<string, unknown>> => {
  try {
    const json: unknown = await context.req.json();
    return isObject(json) ? json : {};
  } catch {
    return {};
  }
};

const normalizeUsername = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length < IDENTITY_USERNAME_MIN_LENGTH ||
    trimmed.length > IDENTITY_USERNAME_MAX_LENGTH
  ) {
    return null;
  }
  return trimmed;
};

// The RP origin/id come from the browser's own Origin header (the surface the
// user is actually on), falling back to the daemon's announced origin. A
// passkey is bound to the RP ID (hostname), so this is also why a passkey
// registered on the loopback origin won't work on the tailnet origin and
// vice-versa — inherent to WebAuthn, surfaced here as expectedOrigin/RPID.
const resolveRp = (
  context: Context,
  getOrigin: () => string | null,
): { origin: string; rpID: string } | null => {
  const raw = context.req.header("origin") || getOrigin();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!url.hostname) return null;
    return { origin: url.origin, rpID: url.hostname };
  } catch {
    return null;
  }
};

// Quick structural reject for the credential response the browser sends; the
// real validation is simplewebauthn's verify (which throws on malformed input,
// caught by the route). The predicate narrows to the library's exact type so
// no cast is needed at the verify call.
const isRegistrationResponse = (value: unknown): value is RegistrationResponseJSON =>
  isObject(value) && typeof value.id === "string" && isObject(value.response);
const isAuthenticationResponse = (value: unknown): value is AuthenticationResponseJSON =>
  isObject(value) && typeof value.id === "string" && isObject(value.response);

interface PasskeyRouteDeps {
  rpName: string;
  registrationOpen: boolean;
  getOrigin: () => string | null;
  userStore: UserStore;
  credentialStore: CredentialStore;
  challenges: ChallengeStore;
  secret: string;
}

const buildPasskeyRoutes = (deps: PasskeyRouteDeps): Hono => {
  const app = new Hono();

  app.get("/passkey/me", (context) => {
    const identity = readSessionIdentity(context, deps.secret);
    return context.json({ user: identity?.user ?? null });
  });

  app.post("/passkey/register/options", async (context) => {
    if (!deps.registrationOpen) {
      return context.json({ error: "registration_closed" }, HTTP_STATUS_FORBIDDEN);
    }
    const body = await readBody(context);
    const username = normalizeUsername(body.username);
    if (!username) return context.json({ error: "invalid_username" }, HTTP_STATUS_BAD_REQUEST);
    const rp = resolveRp(context, deps.getOrigin);
    if (!rp) return context.json({ error: "invalid_origin" }, HTTP_STATUS_BAD_REQUEST);
    const excludeCredentials = (deps.userStore.get(username)?.credentialIds ?? []).map((id) => ({
      id,
    }));
    const options = await generateRegistrationOptions({
      rpName: deps.rpName,
      rpID: rp.rpID,
      userName: username,
      excludeCredentials,
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
    deps.challenges.set(options.challenge, "register");
    return context.json(options);
  });

  app.post("/passkey/register/verify", async (context) => {
    if (!deps.registrationOpen) {
      return context.json({ error: "registration_closed" }, HTTP_STATUS_FORBIDDEN);
    }
    const body = await readBody(context);
    const username = normalizeUsername(body.username);
    if (!username || !isRegistrationResponse(body.response)) {
      return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    }
    const rp = resolveRp(context, deps.getOrigin);
    if (!rp) return context.json({ error: "invalid_origin" }, HTTP_STATUS_BAD_REQUEST);
    const response = body.response;
    let verified: VerifiedRegistrationResponse | undefined;
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: (challenge) => deps.challenges.consume(challenge, "register"),
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
    } catch {
      return context.json({ error: "verification_failed" }, HTTP_STATUS_BAD_REQUEST);
    }
    if (!verified || !verified.verified || !verified.registrationInfo) {
      return context.json({ error: "verification_failed" }, HTTP_STATUS_BAD_REQUEST);
    }
    const credential = verified.registrationInfo.credential;
    deps.userStore.findOrCreate(username);
    deps.userStore.addCredential(username, credential.id);
    deps.credentialStore.put({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64"),
      counter: credential.counter,
      username,
    });
    setSessionCookie(context, deps.secret, username);
    return context.json({ user: username });
  });

  app.post("/passkey/login/options", async (context) => {
    const body = await readBody(context);
    const username = normalizeUsername(body.username);
    const rp = resolveRp(context, deps.getOrigin);
    if (!rp) return context.json({ error: "invalid_origin" }, HTTP_STATUS_BAD_REQUEST);
    const allowCredentials = username
      ? (deps.userStore.get(username)?.credentialIds ?? []).map((id) => ({ id }))
      : undefined;
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      allowCredentials,
      userVerification: "preferred",
    });
    deps.challenges.set(options.challenge, "login");
    return context.json(options);
  });

  app.post("/passkey/login/verify", async (context) => {
    const body = await readBody(context);
    if (!isAuthenticationResponse(body.response)) {
      return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    }
    const response = body.response;
    const rp = resolveRp(context, deps.getOrigin);
    if (!rp) return context.json({ error: "invalid_origin" }, HTTP_STATUS_BAD_REQUEST);
    const stored = deps.credentialStore.get(response.id);
    if (!stored) return context.json({ error: "unknown_credential" }, HTTP_STATUS_BAD_REQUEST);
    const credential: WebAuthnCredential = {
      id: stored.id,
      publicKey: Buffer.from(stored.publicKey, "base64"),
      counter: stored.counter,
    };
    let verified: VerifiedAuthenticationResponse | undefined;
    try {
      verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: (challenge) => deps.challenges.consume(challenge, "login"),
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        credential,
        requireUserVerification: true,
      });
    } catch {
      return context.json({ error: "verification_failed" }, HTTP_STATUS_BAD_REQUEST);
    }
    if (!verified || !verified.verified) {
      return context.json({ error: "verification_failed" }, HTTP_STATUS_BAD_REQUEST);
    }
    deps.credentialStore.updateCounter(stored.id, verified.authenticationInfo.newCounter);
    setSessionCookie(context, deps.secret, stored.username);
    return context.json({ user: stored.username });
  });

  app.post("/passkey/logout", (context) => {
    clearSessionCookie(context);
    return context.json({ ok: true });
  });

  return app;
};

// The self-contained identity provider: localterm is the identity authority.
// `identify` reads the signed session cookie the register/login flow set;
// `denyUnauthenticated: true` makes the gate reject any request without a
// valid session (401 / WS policy-violation) — unlike `header`, there's no
// operator fallback, because there's no external proxy to vouch for one.
// `routes()` is the `/auth/passkey/*` login flow mounted by the daemon.
export const createPasskeyIdentityProvider = (
  config: PasskeyIdentityConfig,
  deps: IdentityProviderDeps,
): IdentityProvider => {
  const rpName = config.rpName?.trim() || IDENTITY_RP_NAME_DEFAULT;
  const registrationOpen = (config.registration ?? "open") === "open";
  const userStore = new UserStore(path.join(deps.stateDirectory, "users.json"));
  const credentialStore = new CredentialStore(path.join(deps.stateDirectory, "credentials.json"));
  const challenges = new ChallengeStore();
  const secret = deps.secret;

  return {
    kind: "passkey",
    denyUnauthenticated: true,
    identify: (context: Context): Identity | null => readSessionIdentity(context, secret),
    routes: () =>
      buildPasskeyRoutes({
        rpName,
        registrationOpen,
        getOrigin: deps.getOrigin,
        userStore,
        credentialStore,
        challenges,
        secret,
      }),
  };
};
