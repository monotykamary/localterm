// Shell completion scripts emitted by `localterm completions <shell>`. Each is
// a thin shim that hands the command line back to the hidden `localterm
// _completion -- <words…>` command, which owns the candidate logic (subcommands,
// option flags, and dynamic values like live session ids). The candidate logic
// is shell-agnostic; the shell name only affects the script's own registration.
// The CLI returns newline-separated candidates; the shell filters by the
// current word's prefix. Candidates are assumed to be single tokens (session
// ids, secret names, and flags never contain spaces).

// bash: `complete -o default -F` registers the handler. When the CLI returns no
// candidates COMPREPLY stays empty and `-o default` falls back to readline
// filename completion, so path-valued options (--cwd, -o) still complete. Uses
// the classic `compgen`+array form (not `mapfile`) so it works on macOS's bash 3.2.
// The same text serves both the stdout/eval script and the bash-completion
// drop-file (it's sourceable either way).
export const buildBashCompletionScript = (): string =>
  [
    "_localterm_completion() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    "  local candidates",
    '  candidates=$(localterm _completion -- "${COMP_WORDS[@]}" 2>/dev/null)',
    "  if [[ -n $candidates ]]; then",
    '    COMPREPLY=($(compgen -W "$candidates" -- "$cur"))',
    "  fi",
    "  return 0",
    "}",
    "complete -o default -F _localterm_completion localterm",
    "",
  ].join("\n");

// zsh (eval/source form): `compadd` receives the newline-split candidates and
// filters by the word on the line. When the CLI returns nothing, fall back to
// `_files` so path-valued options complete (mirroring bash's `-o default`).
// `compdef` is guarded so sourcing before `compinit` (no `compdef` yet) is a
// silent no-op. This is the form `localterm completions zsh` prints and the rc
// lazy block evals.
export const buildZshCompletionScript = (): string =>
  [
    "#compdef localterm",
    "_localterm() {",
    "  local candidates",
    '  candidates=$(localterm _completion -- "${words[@]}" 2>/dev/null)',
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
// `localterm` when it sits on an `fpath` directory and `compinit` has run, with
// zero startup cost (the body is read on first <Tab>).
export const buildZshCompletionFile = (): string =>
  [
    "#compdef localterm",
    "local candidates",
    '  candidates=$(localterm _completion -- "${words[@]}" 2>/dev/null)',
    "  if [[ -n $candidates ]]; then",
    "    compadd -- ${(f)candidates}",
    "  else",
    "    _files",
    "  fi",
    "  return 0",
    "",
  ].join("\n");

// fish: `complete -f` makes the CLI the sole source of candidates (no default
// file completion), so `__localterm_complete` fully owns the menu. The trade-off
// versus bash/zsh is that path-valued options don't auto-complete files; users
// type those paths directly. `commandline -opc` is the tokens before the cursor
// (including the command name); `commandline -ct` is the partial current token.
// The same text serves both the stdout/source script and the fish drop-file.
export const buildFishCompletionScript = (): string =>
  [
    "function __localterm_complete",
    "  set -l words (commandline -opc) (commandline -ct)",
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
