# Identity & multi-user access (SSO)

By default localterm is a single authority — the daemon is loopback-bound and
whoever can reach it (you, over your tailnet or an ssh tunnel) gets full access
with no login. For a shared gateway where several people should reach the daemon
but only their own shells, configure an **identity provider** with
`localterm config identity <provider>`, then restart. The daemon then resolves
an identity per request and partitions the session switcher by user (a
cross-tenant id surfaces as not-found).

## Providers

| Provider      | Who authenticates                                                                                                   | Use when                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **`header`**  | An identity-aware reverse proxy in front (Cloudflare Access, Pomerium, Caddy + OAuth2-Proxy, Authelia forward-auth) | you already run a proxy/SSO; localterm just reads `X-Forwarded-User` it sets |
| **`passkey`** | localterm itself, via WebAuthn (a passkey tap)                                                                      | you want self-contained SSO with no external IdP                             |
| **`oidc`**    | Any OIDC IdP (Google, GitHub, or self-hosted Authentik/Zitadel/Keycloak)                                            | you want to reuse an existing IdP                                            |

`header` trusts the identity header only when the request's source IP is in a
`trustedProxy` allowlist (default `loopback` — the proxy runs on the same host;
pass `10.0.0.0/8`, `private`, or a CIDR for a remote proxy). A trusted-proxy
request with no header is the **operator tier** (full access — the CLI from
loopback and the daemon's own automation keep working).

`passkey` and `oidc` run their own login under `/auth/*`, issue a signed session
cookie, and **reject** an unauthenticated request at the door: the terminal shows
a login screen, and the daemon's own CDP viewer tabs (used by `capture-pane --png`
and real-browser mouse) are minted the session's cookie so they pass the gate. The
CLI can't run a WebAuthn/OIDC ceremony, so for those modes `localterm config
identity` auto-generates an **operator bearer token** (printed once; stored in
the config) that the CLI sends automatically — `localterm` then works as the
operator with full access.

## Configure

```bash
localterm config identity header --trusted-proxy loopback        # proxy on the same host
localterm config identity passkey --registration open            # self-contained; prints an operator token
localterm config identity oidc \
  --issuer https://accounts.example.com \
  --client-id localterm --client-secret …                        # reuse an IdP
localterm restart
```

The config lives in `~/.localterm/config.json`:

```json
{
  "version": 1,
  "identity": {
    "provider": "passkey",
    "registration": "open",
    "operatorToken": "auto-generated-by-the-cli"
  }
}
```

## OIDC example (Google)

Register a client at Google Cloud Console → APIs & Services → Credentials → OAuth
client (Web application), with the redirect URI
`https://<node>.ts.net/auth/oidc/callback` (the daemon's announced origin +
`/auth/oidc/callback` — so OIDC needs a stable announced origin like your tailnet
URL, unlike passkey which binds to whatever origin the browser is on). Then:

```bash
localterm config identity oidc \
  --issuer https://accounts.google.com \
  --client-id …apps.googleusercontent.com \
  --client-secret …
localterm restart
```

Open `https://<node>.ts.net` — the login screen redirects through Google and back,
and the session cookie keeps you signed in across tabs.

## Notes

- Identity is built once at daemon start, so changing it needs a `localterm
restart` (unlike `cdpPort`/`graceSeconds`, which are live).
- `passkey` needs a WebAuthn-capable browser and a **hostname** origin
  (`localhost` or a real domain) — WebAuthn RP IDs must be registrable domains,
  so a bare IP like `127.0.0.1` fails ("This is an invalid domain"), but
  `http://localhost:port` works fine for the local user. `oidc` needs a stable,
  registerable announced origin (its redirect URI is that origin +
  `/auth/oidc/callback`), so a dynamic `http://localhost:port` can't work. For a
  shared gateway reachable by others, expose the daemon on a stable tailnet/https
  origin first; `header` works behind a proxy on any origin.
