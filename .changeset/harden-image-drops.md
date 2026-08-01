---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Make terminal image drops failure-safe: accept blank and nonstandard image MIME metadata, fall back to the dropped file list, block browser navigation for unsupported and URL-backed drops, cancel superseded uploads, time out stalled requests, bound multipart bodies, and write uploaded images without blocking the daemon. Keep pathological finite CIELAB inputs from overflowing theme color conversion.
