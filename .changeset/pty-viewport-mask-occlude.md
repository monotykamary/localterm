---
"@monotykamary/localterm-server": patch
---

Mask the peer-constrained PTY viewport with an opaque fill so stale wide content stops bleeding through.

The viewport mask was a faint 8% wash, but it sits above xterm's canvas, so anything in the dead columns showed through it. The wider local grid retains the lines the PTY streamed at the old width before a narrower peer joined (scrollback isn't reflowed to the effective cols), so on the desktop those stale wide lines — the model list, a long prompt — bled through the wash into the mask. On the phone, the active/limiting viewer, the same content reflows to its own narrow grid and wraps, so there was nothing to bleed.

The mask now fills with the terminal's own theme background (opaque, threaded from the live theme so it tracks theme switches) plus the existing diagonal hatch and hairline. The opaque fill occludes the stale dead-column content so it reads as empty space rather than bleeding through, and matching the live background is subtler than the grey wash it replaces.
