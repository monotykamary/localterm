"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor

---

Make clicking an OSC 9 desktop notification reliably focus the localterm tab, and deliver notifications to all of a user's tabs regardless of which session they're viewing.

Previously the notification was shown with a main-thread `new Notification()` whose `onclick` called `window.focus()` — the path browsers don't honor for raising a background tab, so the click did nothing in Chrome/Firefox/Edge. The terminal now shows the notification through the service worker registration (`registration.showNotification`) so the click fires the SW's `notificationclick` event, which focuses an open localterm tab via `WindowClient.focus()` (the API browsers do honor) and switches it to the emitting session — or opens a new tab seeded with `?sid=` if none is open. Falls back to the old `new Notification()` path when no SW is active (dev / SW not yet controlling).

The daemon also no longer restricts an OSC 9 notification to clients viewing the emitting session. It now fans the message out to every client currently viewing any session owned by the same identity, so a user who stepped away to another session still gets the ping. The fan-out is owner-scoped so a notification never crosses an identity boundary. The message now carries `sessionId` (the emitting PTY) so the SW click can target it; the per-session notification tag coalesces the copies the daemon fanned out across the user's tabs into a single OS notification.
