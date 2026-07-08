---
"@monotykamary/localterm": minor
---

Render the session picker's peer cluster as per-profile face avatars. Each
attached client groups by browser profile and renders as a squircle face — a
stable background color per profile plus four eye variations and a first-letter
mouth, both picked deterministically by the profile's windowId — so a profile
keeps one face across every session row and the count of faces is the viewer
count. Your own profile leads and wears a black ring, and a back-compat client
with no profile id groups under a muted face.
