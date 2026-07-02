import { Hono } from "hono";
import type { Context } from "hono";
import * as oauth from "oauth4webapi";
import type { AuthorizationServer, Client, ClientAuth } from "oauth4webapi";
import {
  AUTH_STATE_TTL_MS,
  IDENTITY_USER_MAX_LENGTH,
} from "../constants.js";
import type { Identity, IdentityProvider, IdentityProviderDeps, OidcIdentityConfig } from "./types.js";
import { clearSessionCookie, readSessionIdentity, setSessionCookie } from "./session-cookie.js";

// Ephemeral, in-memory store for an in-flight OIDC flow, keyed by `state`.
// Holds the PKCE code_verifier, nonce, and where to land after the callback —
// everything needed to complete the authorization-code exchange and resist
// CSRF/replay. Single-use (consumed at the callback), short TTL, lost on
// restart (a flow only lives for minutes).
interface OidcState {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  expiresAt: number;
}

class OidcStateStore {
  private readonly states = new Map<string, OidcState>();

  set(state: string, entry: OidcState): void {
    this.states.set(state, entry);
    const now = Date.now();
    for (const [key, value] of this.states) {
      if (value.expiresAt < now) this.states.delete(key);
    }
  }

  consume(state: string): OidcState | null {
    const entry = this.states.get(state);
    this.states.delete(state);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry;
  }
}

// Only allow same-origin relative paths as the post-login landing target, to
// keep the callback from being an open redirect: a value must start with `/`
// and not `//` (a protocol-relative URL the browser would treat as absolute).
export const sanitizeReturnTo = (value: string | null): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
};

const buildRedirectUri = (origin: string): string => `${origin.replace(/\/$/, "")}/auth/oidc/callback`;

interface OidcRouteDeps {
  issuerUrl: URL;
  client: Client;
  clientAuth: ClientAuth;
  claim: string;
  scope: string;
  getOrigin: () => string | null;
  stateStore: OidcStateStore;
  secret: string;
  getMetadata: () => Promise<AuthorizationServer>;
}

const buildOidcRoutes = (deps: OidcRouteDeps): Hono => {
  const app = new Hono();

  // GET /oidc/login?returnTo=<path> — kick off the auth-code flow: mint PKCE +
  // state + nonce, remember them against `state`, 302 to the IdP's authz
  // endpoint. The `redirect_uri` is the daemon's announced origin + this
  // callback path, which must be registered with the IdP — so OIDC needs a
  // stable announced origin (the tailnet/local-https surface), unlike passkey
  // which binds to whatever origin the browser is on.
  app.get("/oidc/login", async (context) => {
    const origin = deps.getOrigin();
    if (!origin) return context.json({ error: "no_origin" }, 500);
    let metadata: AuthorizationServer;
    try {
      metadata = await deps.getMetadata();
    } catch {
      return context.json({ error: "issuer_unreachable" }, 502);
    }
    if (!metadata.authorization_endpoint) {
      return context.json({ error: "issuer_unsupported" }, 502);
    }
    const redirectUri = buildRedirectUri(origin);
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
    const state = oauth.generateRandomState();
    const nonce = oauth.generateRandomNonce();
    const returnTo = sanitizeReturnTo(new URL(context.req.url).searchParams.get("returnTo"));
    deps.stateStore.set(state, {
      codeVerifier,
      nonce,
      returnTo,
      expiresAt: Date.now() + AUTH_STATE_TTL_MS,
    });
    const params = new URLSearchParams();
    params.set("client_id", deps.client.client_id);
    params.set("redirect_uri", redirectUri);
    params.set("response_type", "code");
    params.set("scope", deps.scope);
    params.set("state", state);
    params.set("nonce", nonce);
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
    const authUrl = new URL(metadata.authorization_endpoint);
    for (const [key, value] of params.entries()) {
      authUrl.searchParams.set(key, value);
    }
    return context.redirect(authUrl.toString(), 302);
  });

  // GET /oidc/callback?code=&state= — the IdP redirects here. Consume the
  // state, validate the response, exchange the code for tokens (verifying the
  // ID-token nonce), fetch userinfo, and issue a session cookie for the
  // configured claim (default email, falling back to `sub`). Any failure
  // redirects to `/` rather than leaking an error page to the browser.
  app.get("/oidc/callback", async (context) => {
    const origin = deps.getOrigin();
    if (!origin) return context.redirect("/", 302);
    const callbackUrl = new URL(context.req.url);
    const state = callbackUrl.searchParams.get("state");
    if (!state) return context.redirect("/", 302);
    const stored = deps.stateStore.consume(state);
    if (!stored) return context.redirect("/", 302);
    try {
      const metadata = await deps.getMetadata();
      const validated = oauth.validateAuthResponse(metadata, deps.client, callbackUrl.searchParams, state);
      const tokenResponse = await oauth.authorizationCodeGrantRequest(
        metadata,
        deps.client,
        deps.clientAuth,
        validated,
        buildRedirectUri(origin),
        stored.codeVerifier,
      );
      const tokens = await oauth.processAuthorizationCodeResponse(metadata, deps.client, tokenResponse, {
        expectedNonce: stored.nonce,
      });
      const userInfo = await oauth.processUserInfoResponse(
        metadata,
        deps.client,
        oauth.skipSubjectCheck,
        await oauth.userInfoRequest(metadata, deps.client, tokens.access_token),
      );
      const raw = userInfo[deps.claim];
      const user = (typeof raw === "string" ? raw : userInfo.sub).slice(0, IDENTITY_USER_MAX_LENGTH);
      setSessionCookie(context, deps.secret, user);
      return context.redirect(stored.returnTo, 302);
    } catch {
      return context.redirect("/", 302);
    }
  });

  app.post("/oidc/logout", (context) => {
    clearSessionCookie(context);
    return context.json({ ok: true });
  });

  app.get("/oidc/me", (context) => {
    const identity = readSessionIdentity(context, deps.secret);
    return context.json({ user: identity?.user ?? null });
  });

  return app;
};

// The bring-your-own-IdP provider: any OIDC IdP (Google, GitHub, or self-hosted
// Authentik/Zitadel/Keycloak) authenticates via an authorization-code + PKCE
// flow; localterm keeps no passwords. Like `passkey`, `identify` reads the
// signed session cookie the callback issued and `denyUnauthenticated` is true
// (the gate rejects a no-session request). Discovery is cached lazily and
// retried on failure; the `redirect_uri` is the daemon's announced origin.
export const createOidcIdentityProvider = (
  config: OidcIdentityConfig,
  deps: IdentityProviderDeps,
): IdentityProvider => {
  const issuerUrl = new URL(config.issuer);
  const client: Client = { client_id: config.clientId };
  const clientAuth = config.clientSecret ? oauth.ClientSecretPost(config.clientSecret) : oauth.None();
  const claim = config.claim ?? "email";
  const scope = config.scope ?? "openid email";
  const stateStore = new OidcStateStore();
  const secret = deps.secret;

  // Cached OIDC discovery (the IdP's metadata). Resolved once, shared across
  // flows; reset to null on failure so the next attempt re-discovers rather
  // than caching a bad result. A single shared promise avoids duplicate
  // concurrent discoveries.
  let metadataPromise: Promise<AuthorizationServer> | null = null;
  const getMetadata = (): Promise<AuthorizationServer> => {
    if (!metadataPromise) {
      metadataPromise = (async () => oauth.processDiscoveryResponse(issuerUrl, await oauth.discoveryRequest(issuerUrl)))();
      metadataPromise.catch(() => {
        metadataPromise = null;
      });
    }
    return metadataPromise;
  };

  return {
    kind: "oidc",
    denyUnauthenticated: true,
    identify: (context: Context): Identity | null => readSessionIdentity(context, secret),
    routes: () =>
      buildOidcRoutes({
        issuerUrl,
        client,
        clientAuth,
        claim,
        scope,
        getOrigin: deps.getOrigin,
        stateStore,
        secret,
        getMetadata,
      }),
  };
};
