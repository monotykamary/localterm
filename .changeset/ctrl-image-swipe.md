---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Move image upload onto a Ctrl-key swipe instead of a dedicated keyboard key.

The image-upload affordance added a key to the on-screen keyboard's bottom
row, which threw off the layout. It now lives on a bottom-left slide of the
Ctrl key (the framed-picture corner), reusing the keyboard's existing slide
mechanic, so the bottom row keeps its original four-key shape.