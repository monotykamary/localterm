---
"@monotykamary/localterm": minor
---

Add client-side predictive typing so keystrokes feel instant on high-latency links (a tailnet over a DERP relay, a phone on cellular) without changing the local surface.

Each printable keystroke is written to xterm.js immediately in a faint "unconfirmed" style; the server's real echo overwrites it in normal intensity when it arrives — the mosh model, on top of xterm.js. A self-measured round-trip gate keeps prediction off on fast links (no per-keystroke flash) and turns it on only when latency exceeds ~50ms, so the common local / direct-tailnet path is unchanged. Reconciliation is a streaming prefix match with a cursor-forward fixup so chunked echoes don't desync, and a mismatch (a syntax-highlighting shell that reprints the line) erases the dim span and defers to the real output.

Safety: prediction runs only at the shell prompt in the normal buffer (no foreground program, not the alt screen) — the same state localterm already classifies for the grey "ready" favicon — so TUIs and raw-mode programs are excluded by construction. A watchdog erases any unconfirmed prediction after 1s + a cooldown, so a misdetected no-echo prompt (a password) can never leave typed text visible. Toggled via Settings → Typing → Predictive typing (on by default). Server unchanged: the prediction is a client-side render illusion; the real keystroke still travels the wire.
