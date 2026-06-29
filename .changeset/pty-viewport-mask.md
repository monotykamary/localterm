---
"@monotykamary/localterm-server": patch
---

Mask the dead area beyond a peer-constrained PTY viewport as inactive chrome.

A PTY is resized tmux-style to the min cols/rows across every attached client, so
when a phone (≈40 cols) joins a desktop (≈120 cols) the PTY streams into a 40-col
region while the desktop's wider xterm fills the remaining ~80 columns with empty
terminal background — indistinguishable from usable space, with nothing conveying
that the _active_ viewport is the phone's.

The server never told any client what the effective size was: the only size message
in the protocol was client→server (`resize`), and the `session` frame carries no
cols/rows. So the desktop had no idea the live region ended 80 columns ago.

The server now broadcasts a `pty-size` frame (the min cols/rows across clients)
whenever that min changes — on a peer attach/detach, or any client resize — and
seeds a joiner that enters an already-constrained session without changing the min.
A lone viewer is never constrained (its effective size always equals its own), so
it's left quiet except for one clear frame when a peer detaches and drops it back
to solo, which erases the mask the leaving peer had imposed.

The terminal masks the dead columns beyond the effective width as a single full-height band
flush to the surface's top, right, and bottom, with the configured horizontal padding as
the gap on its left (from the live viewport's right edge). Only the vertical boundary is
masked — the horizontal one conveys nothing the vertical doesn't, and a phone with the
keyboard down is often taller than the desktop (so the desktop is the row-limiter) and
masking the phone's own bottom read as a bleed and wasted its limited vertical space. The
mask is gated on the local grid being wider than the effective size (a col count, not a
pixel sliver, so sub-pixel rounding from xterm's centered screen never renders a phantom
line on the limiting viewer). It is null — nothing rendered — when the local grid already
matches the effective size (sole/limiting viewer, no constraining peer) or the terminal
isn't measurable yet, and it's cleared on every session frame so a switch never inherits
the prior PTY's mask.
