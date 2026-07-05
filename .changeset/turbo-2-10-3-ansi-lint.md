---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Update turbo to 2.10.3 (codemod `@turbo/codemod update`; `turbo.json` `$schema` bumped to `v2-10-3`) and silence the `no-control-regex` warnings in the ANSI/terminal-escape parsers.

**Turbo.** `^2.10.2` → `^2.10.3`; the codemod reported no config migrations were required, only the schema URL refresh.

**Lint.** `strip-ansi.ts`, `terminal-mode-state.ts`, and `terminal-query-responder.ts` match `\x1b` (ESC) to parse ANSI/VT, CSI/OSC, DECRQM, and Device-Attribute sequences — control characters are the entire point of the regexes. Each now scopes a targeted `eslint-disable no-control-regex` (block or next-line) with the rationale, so `pnpm lint` runs clean with zero warnings.
