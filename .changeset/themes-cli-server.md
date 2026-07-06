---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add CLI + server management for terminal themes, shared with the browser UI.

Terminal themes (the built-in catalog + user-imported customs + the active selection) are now server-managed state in `~/.localterm/themes.json`, so the `localterm theme` CLI and every browser tab share one source of truth — replacing the per-browser `localStorage` the UI used to keep.

**CLI.** New `localterm theme` command group: `theme list` (built-ins + imports, active one marked), `theme get` (active id + name), `theme import <file>` (JSON `{name, colors}` / bare colors, or an iTerm `.itermcolors` plist → stored custom), `theme set <id>` (a built-in, `auto`, or a custom id), `theme delete <id>`. Tab-completion: `theme set` completes built-ins + `auto` + customs; `theme delete` completes customs.

**Server.** New endpoints under `/api/themes`: `GET` (active id + custom library + an `initialized` flag), `POST /themes/import` (raw text + filename → the daemon parses with one parser shared by the browser upload and the CLI), `PUT /themes/active`, `DELETE /themes/:id`, and a one-time `POST /themes/migrate` the browser uses to push legacy `localStorage` state on first contact with an uninitialized store (ids preserved) so an upgrade never loses the user's themes.

**Browser.** The settings hook reconciles its `localStorage` cache against the server on mount + a slow poll so a CLI `set`/`import`/`delete` reaches open tabs; import/select/delete now write through to the server. The built-in theme catalog moved to the server package (`@monotykamary/localterm-server/themes`) so the CLI, server, and UI read one source.

**Skill.** Added `references/themes.md` and a Themes section to the localterm skill covering the CLI, the REST endpoints, import formats, and error responses.
