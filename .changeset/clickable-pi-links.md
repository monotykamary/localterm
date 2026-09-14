---
"@monotykamary/localterm": patch
---

Make the OSC 8 links pi prints clickable. xterm's OSC 8 provider drops every link that isn't http(s) unless `linkHandler.allowNonHttpProtocols` is set, so pi's file:// tool-output paths and the scheme-less markdown hrefs a model writes painted the hyperlink dashed underline yet never reached a click handler. http(s) links now open in a new tab; file and cwd-relative links open the read-only /api/file preview.
