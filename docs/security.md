# Security

- By default, binds loopback (`127.0.0.1`) and enforces loopback `Host`/`Origin`
  headers to defeat DNS-rebinding and cross-origin attacks.
- To share the daemon across machines, prefer `localterm install`'s Tailscale
  step — it surfaces the daemon on your tailnet at `https://<node>.ts.net` over a
  real Let's Encrypt cert, on an end-to-end-encrypted WireGuard mesh, with no port
  exposed to the public internet.
- Pass `-H 0.0.0.0` (or any non-loopback address) to expose the server on all
  network interfaces. In this mode, `Host`/`Origin` must be from a private network
  (RFC 1918, CGNAT/Tailscale `100.64.127.x`, link-local, `*.localhost`) and
  WebSocket source IPs are filtered to private ranges — only use on trusted
  networks.
- One PTY per WebSocket. Closing a tab detaches — the shell waits in the session
  switcher for a grace window (~30s) and is reaped if nobody reattaches; kill it
  sooner from the switcher.

## Multi-user access

For a shared gateway where several people should reach the daemon but only
their own shells, configure an identity provider — see
[Identity & SSO](identity.md).

## Secrets

Per-program secrets are Keychain-backed and never returned over the API; the
daemon injects them only into the shimmed process's env. See the
[secrets-sessions reference](../skills/localterm/references/secrets-sessions.md)
for the threat model and the PATH-shim injection mechanism, and
[pi integration](pi.md) for the secret-scrubbing extension that keeps pi's bash
tool from leaking them to child commands.
