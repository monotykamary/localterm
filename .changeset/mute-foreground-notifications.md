---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Mute desktop notifications on the tab already viewing the session.

The daemon fans each OSC 9 notification out to every connected tab. A tab already viewing the emitting session in the foreground can see the result on screen (e.g. pi finishing a turn), so it now skips the OS notification instead of duplicating what the user is watching. The check uses `document.hasFocus()` rather than `document.hidden` so a localterm window left visible behind another app still pings when focus leaves it.
