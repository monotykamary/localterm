---
"@monotykamary/localterm": patch
---

Keep the installed PWA portrait so it honors a portrait rotation lock.

The Web App Manifest's `orientation` member is an app-level policy with no
value meaning "follow the system rotation lock." The default (`"any"`,
applied whether the field is omitted or set explicitly) makes an installed
PWA (WebAPK) on Android rotate with the sensor and ignore the lock — which
is why localterm kept rotating despite a portrait lock. Setting
`orientation: "portrait"` constrains the WebAPK activity to portrait,
matching a portrait lock. This hardcodes portrait (it won't follow a
future landscape lock or allow landscape auto-rotate); for a terminal,
portrait is the conventional orientation. WebAPKs bake the manifest in at
install time, so remove the home-screen icon and re-add it after rebuilding
for the change to take effect.
