---
"@monotykamary/localterm": patch
---

Respect the device rotation lock in the installed PWA.

The manifest no longer declares an explicit `orientation`. Now that the service worker makes localterm a genuinely installable PWA (WebAPK), Android applies the manifest's `orientation` as an app-level policy — and an explicit `"any"` is treated as "accept all orientations," which makes the installed app rotate with the sensor regardless of the system rotation lock. Omitting the field lets the installed app inherit the OS default, which honors the lock — the same behavior the old Add-to-Home-Screen shortcut had when it opened inside Chrome proper.
