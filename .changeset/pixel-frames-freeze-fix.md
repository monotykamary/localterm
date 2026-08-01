---
"@monotykamary/localterm-server": patch
"@monotykamary/localterm": patch
---

Fix pixel-frame overlay freezing on app exit. The scanner now watches PTY output for alt-screen-leave sequences (?1049l / ?1047l / ?47l, matching terminal-browser's restore) and hard resets (ESC c); when a frame-relaying session exits, the daemon broadcasts a pixel-frames-clear control and cancels any in-flight relay read, so clients drop the overlay and the restored shell shows immediately. Verified end-to-end against a real PTY: frames relay losslessly (emit == relay), one clear message per exit, no frames after.
