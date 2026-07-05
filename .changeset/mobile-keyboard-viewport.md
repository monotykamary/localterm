---
"@monotykamary/localterm": patch
---
Fix mobile on-screen-keyboard resize artifacting in the PWA.

The viewport meta now sets `interactive-widget=resizes-content` so Android
Chrome shrinks the layout viewport above the keyboard in one browser-driven
pass — no per-frame JS. The hand-rolled root shrink+translate runs only on
Apple WebKit (which ignores `interactive-widget`), `requestAnimationFrame`-
coalesced and with the transform dropped at zero offset, so iOS keeps the
terminal usable above the keyboard without the per-frame thrash that tore
xterm's canvas on Android.
