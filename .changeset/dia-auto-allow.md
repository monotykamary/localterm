---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Auto-dismiss Dia's "Allow debugging connection?" prompt on the daemon's CDP socket (macOS).

- Dia is the only Chromium browser that gates the debugging connection behind an
  `Allow debugging connection?` prompt (Return dismisses it). When the daemon's
  persistent CDP WebSocket is still CONNECTING past `CDP_AUTO_ALLOW_DELAY_MS`
  (600ms — a live WS opens in ~100ms, so "still connecting at 600ms" means the
  prompt is up), the daemon fires one Return at the Dia process via `osascript`
  so the socket opens with no manual click. A no-op for every other browser and
  off macOS; cleared on a fast handshake so it never fires unnecessarily.
- New `packages/server/src/utils/dismiss-dia-allow-prompt.ts` owns the osascript
  call (one focused utility). `CdpClient.openSocket` arms the per-attempt dismiss
  timer, gated on the candidate browser being Dia + macOS + `autoAllow` (on by
  default). `autoAllow`/`autoAllowDelayMs`/`dismissDiaAllowPrompt`/`platform` are
  injected via `CdpClientOptions` for deterministic tests; every connect/reconnect
  inherits it.
- Needs macOS Accessibility for the `node` binary running the daemon; without it
  the keystroke is dropped (`osascript` errors -25211, swallowed) and connect
  waits on its timeout — no regression vs. the feature being off.
