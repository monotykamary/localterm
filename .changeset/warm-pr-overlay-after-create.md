---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fix the ambient PR overlay not appearing after pi (or a human) creates a PR.

The toolbar's PR lease only re-fires on a cwd change, a branch divergence, or
an explicit refresh. `gh pr create` changes only the remote (`origin/<branch>`),
not the local branch, so the divergence check never fires and the lease stayed at
its pre-creation null — the overlay never showed until the next unrelated re-lease.

Three complementary paths now warm the overlay:

- An injected `gh` shell wrapper (zsh + bash) captures `gh pr create`'s stdout
  (where the CLI prints the URL; prompts stay on stderr and interactive) and, on
  exit 0, emits a new `pr-created` OSC carrying the URL. Deterministic and
  zero-round-trip — but bypassed by agents that spawn `gh` in a non-interactive
  child (pi sources no rcfile from its `-c` shell).
- A server-side PTY stream scan strips ANSI and, once output settles, emits the
  same `pr-created` message for a single distinct GitHub PR URL in a sliding
  window — catches pi echoing the URL (pi never enters the alternate screen, so
  the bytes survive) and any `gh` invocation the wrapper missed. A multi-URL
  burst (`gh pr list --json`, merge-commit-heavy `git log`) is suppressed via the
  single-distinct-in-settled-window guard.
- A debounced foreground `pi -> null` re-lease is the guaranteed fallback for a
  silent agent (creates the PR without echoing a URL): the trailing-edge collapse
  coalesces pi's push+create burst into one `gh pr list`, and it skips the re-lease
  when an inline set (wrapper URL or scanned URL) already landed within the
  freshness window — so the inline paths avoid a redundant subprocess.

The client inline-sets the PR off any `pr-created` URL — `number`/`url`/`state`
from the URL, `baseRef`/`baseRefName` seeded best-effort from the leased default
base — so the indicator appears instantly with no `gh` round-trip; the base is
corrected on the next cwd/branch re-lease or when the diff viewer resolves it
server-side.
