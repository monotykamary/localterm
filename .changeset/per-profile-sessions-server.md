---
"@monotykamary/localterm-server": minor
---

Track per-browser-profile clients in the session list. A new `?wid=` WS-upgrade
param carries a per-browser-profile handle the terminal mints into `localStorage`
(which the browser partitions per profile, so every tab of one profile shares it).
The daemon tags each attached client with it and breaks the session list's
`clients` count down by profile in a new additive, optional `clientProfiles` field
(`{ windowId, count }[]`). Back-compat clients that don't send `wid` group under
`""`, and the field is optional so an older daemon's responses still parse.
