# Usage

The mental model is **shell = browser tab**, but a tab is just a view onto a
shell that outlives it for a grace window.

- **New tab** → new shell (one authority spawns it).
- **Close tab** → the shell detaches and waits (dormant) in the session switcher (top-right) for ~30s; reattach in that window (from this tab or another joining alongside) or it's reaped — no zombies. A dormant shell that's still producing output (a build, a long command), or still running a foreground program even when quiet (a `sleep`, a paused build), is kept alive, so a closed tab never kills a running command mid-stream.
- **Reload tab** → fresh shell for this tab (the prior one waits in the switcher like any closed tab).
- **Switch** → the session switcher re-points this tab at any live shell; the one you left detaches and waits its grace window.

Transient connection drops silently reattach to the same shell (auto-reconnect
is built in for transport failures). A shell nobody is viewing is reaped once
it's truly idle — a shell still producing output, or still running a foreground
program even when quiet, is kept alive even with no viewers, and only an idle
one dies within the grace window. Kill the ones you're done with sooner from
the switcher.

If you want a shell that survives a full page reload in the _same_ tab, run
`tmux` _inside_ localterm.

## The session switcher

The session switcher (top-right, or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>I</kbd>)
lists every live shell — the one this tab is viewing, others attached in
different tabs, and dormant ones waiting out their grace window. Each row's
terminal icon is colored by activity, matching the tab favicon:

- **green** while output is streaming,
- **blue** while a foreground program runs quietly,
- **grey** when idle at the prompt.

Click a row to switch this tab onto that shell; hover a row to kill it. Search
by title, path, or shell. It's also in the command palette
(<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> → Sessions).

## Related

- [Shells](shells.md) — picking which shell a new tab spawns.
- [Appearance](appearance.md) — themes and fonts.
- [CLI reference](cli.md) — driving sessions headlessly.
