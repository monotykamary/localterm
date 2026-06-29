---
"@monotykamary/localterm-server": patch
---

Reflow the local grid to the PTY's effective cols so the dead columns carry no stale content, keeping the mask.

The viewport mask sat over xterm's canvas, and the wider local grid retained the lines the PTY streamed at the old width before a narrower peer joined — scrollback isn't reflowed when the PTY shrinks — so on the desktop those stale wide lines (a model list, a long prompt) bled through the mask's wash. On the phone, the active/limiting viewer, the grid already matched the effective size and reflowed, so the same content wrapped and there was nothing to bleed.

The client now clamps its xterm grid to the effective cols (the min across clients) on every `pty-size` frame, so xterm reflows the whole buffer to the effective width and the dead columns become empty page background. The screen is left-aligned so the live viewport stays at the left and the mask covers the right gutter as before; the grid keeps the local natural row height so the terminal stays full-height. The server is still told the viewer's NATURAL cols (not the clamped grid) — the min-across-clients needs each viewer's real size so a wider viewer can grow the PTY back when the narrowing peer leaves; reporting the clamped size would deadlock it at the narrow width.
