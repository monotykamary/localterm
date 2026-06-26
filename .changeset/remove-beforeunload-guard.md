---
"@monotykamary/localterm": patch
---

Drop the redundant "leave site?" beforeunload guard. The prompt fired on tab close while a foreground program was running (vim, a build) to keep the user from killing the PTY. With daemon-side PTY multiplexing, closing a tab now detaches instead of killing — the shell survives the no-clients grace window and any tab can reattach from the session switcher (and, after the refresh-reattach change, via `?sid=` on reload). The guard's only remaining effect was an annoying confirmation dialog for a close that's no longer destructive, so it's removed along with the `onModalOpenChange`/`onForegroundProcessChange` props on `Terminal` that existed solely to feed it.
