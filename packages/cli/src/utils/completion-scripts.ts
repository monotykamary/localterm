import { COMPLETION_DAEMON_CURL_TIMEOUT_SECONDS } from "../constants.js";

// Shell completion scripts emitted by `localterm completions <shell>`. Each is
// a two-tier shim: on <Tab> it first asks the already-running daemon to compute
// candidates in-process (one curl to /api/completion, ~ms, no Node startup),
// and on any failure (daemon down, auth-gated 401 in passkey/oidc mode, missing
// curl, non-2xx) it falls back to `localterm _completion` — the hidden CLI
// command that walks the same tree. The fast path needs the daemon's port file
// (~/.localterm/server.port); without it, the script goes straight to the CLI.
// Candidates are newline-separated single tokens (session ids, secret names,
// flags never contain spaces).

// bash: `complete -o default -F` registers the handler. `curl -f` fails silently
// (no body, non-zero exit) on HTTP errors, so a 401/404/5xx falls through to the
// CLI; a 200 with no candidates leaves COMPREPLY empty so `-o default` falls back
// to readline filename completion for path-valued options. Classic
// `compgen`+array form (not `mapfile`) for macOS bash 3.2. Serves both the
// stdout/eval script and the bash-completion drop-file.
export const buildBashCompletionScript = (): string =>
  [
    "_localterm_completion() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    '  local candidates=""',
    '  local port; port=$(cat "${HOME}/.localterm/server.port" 2>/dev/null)',
    "  if [[ -n $port ]]; then",
    '    local host; host=$(cat "${HOME}/.localterm/server.host" 2>/dev/null)',
    "    host=${host:-127.0.0.1}",
    "    local args=()",
    "    local w",
    '    for w in "${COMP_WORDS[@]}"; do args+=(--data-urlencode "argv=$w"); done',
    "    local curlStatus",
    "    candidates=$(curl -fs -G --max-time " +
      COMPLETION_DAEMON_CURL_TIMEOUT_SECONDS +
      ' "http://${host}:${port}/api/completion" "${args[@]}" 2>/dev/null)',
    "    curlStatus=$?",
    "    if [[ $curlStatus -ne 0 ]]; then",
    '      candidates=$(localterm _completion -- "${COMP_WORDS[@]}" 2>/dev/null)',
    "    fi",
    "  else",
    '    candidates=$(localterm _completion -- "${COMP_WORDS[@]}" 2>/dev/null)',
    "  fi",
    "  if [[ -n $candidates ]]; then",
    '    COMPREPLY=($(compgen -W "$candidates" -- "$cur"))',
    "  fi",
    "  return 0",
    "}",
    "complete -o default -F _localterm_completion localterm",
    "",
  ].join("\n");

// zsh (eval/source form): the daemon fast path, then `compadd` the newline-split
// candidates (filtered by the word on the line) or `_files` when empty. `compdef`
// is guarded so sourcing before `compinit` is a silent no-op. `local curlStatus`
// captures curl's exit before the next command resets `$?`.
export const buildZshCompletionScript = (): string =>
  [
    "#compdef localterm",
    "_localterm() {",
    '  local candidates=""',
    '  local port; port=$(cat "${HOME}/.localterm/server.port" 2>/dev/null)',
    "  if [[ -n $port ]]; then",
    '    local host; host=$(cat "${HOME}/.localterm/server.host" 2>/dev/null)',
    "    host=${host:-127.0.0.1}",
    "    local -a args=()",
    "    local w",
    '    for w in "${words[@]}"; do args+=(--data-urlencode "argv=$w"); done',
    "    local curlStatus",
    "    candidates=$(curl -fs -G --max-time " +
      COMPLETION_DAEMON_CURL_TIMEOUT_SECONDS +
      ' "http://${host}:${port}/api/completion" "${args[@]}" 2>/dev/null)',
    "    curlStatus=$?",
    "    if [[ $curlStatus -ne 0 ]]; then",
    '      candidates=$(localterm _completion -- "${words[@]}" 2>/dev/null)',
    "    fi",
    "  else",
    '    candidates=$(localterm _completion -- "${words[@]}" 2>/dev/null)',
    "  fi",
    "  if [[ -n $candidates ]]; then",
    "    compadd -- ${(f)candidates}",
    "  else",
    "    _files",
    "  fi",
    "  return 0",
    "}",
    "if command -v compdef >/dev/null 2>&1; then",
    "  compdef _localterm localterm",
    "fi",
    "",
  ].join("\n");

// zsh (fpath drop-file form): the file IS the `_localterm` function body — no
// `_localterm() {}` wrapper, no explicit `compdef`. The leading `#compdef
// localterm` makes zsh autoload this file as the completion function for
// `localterm` when it sits on an `fpath` directory and `compinit` has run.
export const buildZshCompletionFile = (): string =>
  [
    "#compdef localterm",
    'local candidates=""',
    'local port; port=$(cat "${HOME}/.localterm/server.port" 2>/dev/null)',
    "if [[ -n $port ]]; then",
    '  local host; host=$(cat "${HOME}/.localterm/server.host" 2>/dev/null)',
    "  host=${host:-127.0.0.1}",
    "  local -a args=()",
    "  local w",
    '  for w in "${words[@]}"; do args+=(--data-urlencode "argv=$w"); done',
    "  local curlStatus",
    "  candidates=$(curl -fs -G --max-time " +
      COMPLETION_DAEMON_CURL_TIMEOUT_SECONDS +
      ' "http://${host}:${port}/api/completion" "${args[@]}" 2>/dev/null)',
    "  curlStatus=$?",
    "  if [[ $curlStatus -ne 0 ]]; then",
    '    candidates=$(localterm _completion -- "${words[@]}" 2>/dev/null)',
    "  fi",
    "else",
    '  candidates=$(localterm _completion -- "${words[@]}" 2>/dev/null)',
    "fi",
    "if [[ -n $candidates ]]; then",
    "  compadd -- ${(f)candidates}",
    "else",
    "  _files",
    "fi",
    "return 0",
    "",
  ].join("\n");

// fish: `complete -f` makes the completer the sole source of candidates. On a
// successful curl the candidates are already on stdout and the function returns;
// on any failure (or no port file) it falls through to the CLI. `commandline
// -opc`/`-ct` are the tokens before the cursor and the partial current token.
// Serves both the stdout/source script and the fish drop-file.
export const buildFishCompletionScript = (): string =>
  [
    "function __localterm_complete",
    "  set -l words (commandline -opc) (commandline -ct)",
    '  set -l port (cat "$HOME/.localterm/server.port" 2>/dev/null)',
    '  if test -n "$port"',
    '    set -l host (cat "$HOME/.localterm/server.host" 2>/dev/null)',
    '    test -z "$host"; and set host 127.0.0.1',
    "    set -l args",
    "    for w in $words",
    '      set -a args --data-urlencode "argv=$w"',
    "    end",
    "    if curl -fs -G --max-time " +
      COMPLETION_DAEMON_CURL_TIMEOUT_SECONDS +
      ' "http://$host:$port/api/completion" $args 2>/dev/null',
    "      return",
    "    end",
    "  end",
    "  localterm _completion -- $words 2>/dev/null",
    "end",
    'complete -c localterm -a "(__localterm_complete)" -f',
    "",
  ].join("\n");

// The script `localterm completions <shell>` prints to stdout (for `eval` /
// `source` / the rc lazy block).
export const completionScriptFor = (shell: string): string => {
  switch (shell) {
    case "bash":
      return buildBashCompletionScript();
    case "zsh":
      return buildZshCompletionScript();
    case "fish":
      return buildFishCompletionScript();
    default:
      return "";
  }
};

// The file content written to a shell's completion drop-directory (auto-loaded,
// no rc edit). bash/fish reuse their source script; zsh needs the fpath-body
// form (see buildZshCompletionFile).
export const completionFileFor = (shell: string): string => {
  switch (shell) {
    case "bash":
      return buildBashCompletionScript();
    case "zsh":
      return buildZshCompletionFile();
    case "fish":
      return buildFishCompletionScript();
    default:
      return "";
  }
};
