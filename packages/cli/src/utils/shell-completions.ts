import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import kleur from "kleur";
import {
  COMPLETION_RC_BLOCK_BEGIN,
  COMPLETION_RC_BLOCK_END,
  COMPLETION_SUPPORTED_SHELLS,
} from "../constants.js";
import { completionFileFor } from "./completion-scripts.js";

const execFileAsync = promisify(execFile);

export interface WireResult {
  method: "drop-dir" | "rc";
  path: string;
}

export interface UnwireResult {
  rcRemoved: boolean;
  dropRemoved: boolean;
  dropPath?: string;
}

export const rcRelativePath = (shell: string): string | null => {
  switch (shell) {
    case "bash":
      return ".bashrc";
    case "zsh":
      return ".zshrc";
    case "fish":
      return ".config/fish/config.fish";
    default:
      return null;
  }
};

export const rcPathFor = (shell: string): string | null => {
  const relative = rcRelativePath(shell);
  return relative ? path.join(os.homedir(), relative) : null;
};

export const sourceLineFor = (shell: string): string => {
  switch (shell) {
    case "bash":
      // Guarded: a no-op (no startup noise) when localterm isn't on PATH.
      return 'command -v localterm >/dev/null 2>&1 && eval "$(localterm completions bash)"';
    case "zsh":
      // Lazy + guarded: the real completion script (a ~230ms node spawn) is
      // deferred to the first <Tab> via a one-shot stub that evals it, gets
      // replaced by the real _localterm, and forwards the in-flight call. The
      // guards make it a silent no-op when localterm or compdef isn't available.
      return [
        "if command -v localterm >/dev/null 2>&1 && command -v compdef >/dev/null 2>&1; then",
        "  _localterm_lazy() {",
        "    unset -f _localterm_lazy",
        '    eval "$(localterm completions zsh)"',
        '    _localterm "$@"',
        "  }",
        "  compdef _localterm_lazy localterm",
        "fi",
      ].join("\n");
    case "fish":
      return "type -q localterm; and localterm completions fish | source";
    default:
      return `eval "$(localterm completions ${shell})"`;
  }
};

export const buildCompletionBlock = (shell: string): string =>
  [COMPLETION_RC_BLOCK_BEGIN, sourceLineFor(shell), COMPLETION_RC_BLOCK_END].join("\n");

export const hasCompletionBlock = (content: string): boolean =>
  content.includes(COMPLETION_RC_BLOCK_BEGIN) && content.includes(COMPLETION_RC_BLOCK_END);

export const removeCompletionBlock = (content: string): string => {
  const lines = content.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line === COMPLETION_RC_BLOCK_BEGIN) {
      skipping = true;
      continue;
    }
    if (line === COMPLETION_RC_BLOCK_END) {
      skipping = false;
      continue;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n");
};

// Each shell's conventional completion drop-directory, which it auto-loads from
// with no rc edit. fish always has one (we create it on write); bash only when
// bash-completion ≥2.12 has already created its user dir; zsh only when a
// writable directory is already on `fpath` (oh-my-zsh etc.) — we never create
// one, since putting a dir on `fpath` would itself require an rc edit.

const fishCompletionFilePath = (): string =>
  path.join(os.homedir(), ".config", "fish", "completions", "localterm.fish");

const bashCompletionUserDir = (): string =>
  path.join(os.homedir(), ".local", "share", "bash-completion", "completions");

const bashCompletionUserFilePath = (): string => path.join(bashCompletionUserDir(), "localterm");

// Pure: from a zsh `fpath` listing, pick the first writable directory under the
// user's home and return its `_localterm` path, or null. System fpath dirs
// (outside $HOME) are skipped — we only write into user-owned dirs.
export const resolveZshDropFile = (fpathDirs: readonly string[]): string | null => {
  const home = os.homedir();
  for (const dir of fpathDirs) {
    if (dir !== home && !dir.startsWith(`${home}${path.sep}`)) continue;
    try {
      accessSync(dir, constants.W_OK);
      return path.join(dir, "_localterm");
    } catch {
      // not writable; keep scanning
    }
  }
  return null;
};

const queryZshFpath = async (): Promise<readonly string[]> => {
  try {
    const { stdout } = await execFileAsync("zsh", ["-c", "print -l $fpath"], { timeout: 3000 });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

// The drop-file path when the shell's completion system can auto-load it (no rc
// edit), or null to fall back to the rc block.
export const completionDropFile = async (shell: string): Promise<string | null> => {
  switch (shell) {
    case "fish":
      return fishCompletionFilePath();
    case "bash":
      return existsSync(bashCompletionUserDir()) ? bashCompletionUserFilePath() : null;
    case "zsh":
      return resolveZshDropFile(await queryZshFpath());
    default:
      return null;
  }
};

const ensureRcBlock = (shell: string): void => {
  const rcPath = rcPathFor(shell);
  if (!rcPath) return;
  mkdirSync(path.dirname(rcPath), { recursive: true });
  const existing = existsSync(rcPath) ? readFileSync(rcPath, "utf8") : "";
  if (hasCompletionBlock(existing)) return;
  const prefix = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  writeFileSync(rcPath, `${prefix}${buildCompletionBlock(shell)}\n`, "utf8");
};

const removeRcBlock = (shell: string): void => {
  const rcPath = rcPathFor(shell);
  if (!rcPath || !existsSync(rcPath)) return;
  const content = readFileSync(rcPath, "utf8");
  if (!hasCompletionBlock(content)) return;
  writeFileSync(rcPath, removeCompletionBlock(content), "utf8");
};

// Wire completions for one shell, preferring the auto-loaded drop-file (no rc
// edit) and falling back to a guarded rc block. Switching methods removes the
// other's artifact so there's a single source of truth, and a re-run is a
// no-op (idempotent on both paths).
export const wireShellCompletions = async (shell: string): Promise<WireResult> => {
  const dropFile = await completionDropFile(shell);
  if (dropFile) {
    mkdirSync(path.dirname(dropFile), { recursive: true });
    writeFileSync(dropFile, completionFileFor(shell), "utf8");
    removeRcBlock(shell);
    return { method: "drop-dir", path: dropFile };
  }
  const rcPath = rcPathFor(shell);
  if (!rcPath) throw new Error(`no rc file for shell '${shell}'`);
  ensureRcBlock(shell);
  return { method: "rc", path: rcPath };
};

// Remove the completion from both the drop-file and the rc block for one shell.
export const unwireShellCompletions = async (shell: string): Promise<UnwireResult> => {
  let rcRemoved = false;
  const rcPath = rcPathFor(shell);
  if (rcPath && existsSync(rcPath)) {
    const content = readFileSync(rcPath, "utf8");
    if (hasCompletionBlock(content)) {
      writeFileSync(rcPath, removeCompletionBlock(content), "utf8");
      rcRemoved = true;
    }
  }
  let dropRemoved = false;
  let dropPath: string | undefined;
  const dropFile = await completionDropFile(shell);
  if (dropFile && existsSync(dropFile)) {
    try {
      unlinkSync(dropFile);
      dropRemoved = true;
      dropPath = dropFile;
    } catch {
      // race or permission; leave it
    }
  }
  return { rcRemoved, dropRemoved, dropPath };
};

const detectShell = (): string | null => {
  const name = path.basename(process.env.SHELL ?? "");
  return (COMPLETION_SUPPORTED_SHELLS as readonly string[]).includes(name) ? name : null;
};

const printWireResult = (shell: string, result: WireResult): void => {
  if (result.method === "drop-dir") {
    console.log(kleur.green(`  ✔ ${shell} completions installed → ${result.path}`));
    console.log(
      kleur.dim("    start a new shell; the shell auto-loads it from its completion directory"),
    );
    return;
  }
  console.log(kleur.green(`  ✔ ${shell} completions wired → ${result.path}`));
  console.log(kleur.dim("    start a new shell, or source the rc file"));
  for (const other of COMPLETION_SUPPORTED_SHELLS) {
    if (other === shell) continue;
    console.log(kleur.dim(`    using ${other}? run: localterm completions ${other} --install`));
  }
};

// `localterm install` step: wire the detected shell.
export const setupShellCompletions = async (): Promise<void> => {
  console.log();
  console.log(kleur.cyan("completions  — tab-completion for subcommands, sessions, secrets"));
  const shell = detectShell();
  if (!shell) {
    console.warn(kleur.yellow("  ⚠ $SHELL is not bash/zsh/fish — skipped"));
    console.warn(kleur.dim("    run: localterm completions <bash|zsh|fish> --install"));
    return;
  }
  printWireResult(shell, await wireShellCompletions(shell));
};

// `localterm uninstall` step: tear down every supported shell (both methods).
export const teardownShellCompletions = async (): Promise<void> => {
  let removedAny = false;
  for (const shell of COMPLETION_SUPPORTED_SHELLS) {
    const result = await unwireShellCompletions(shell);
    if (result.rcRemoved || result.dropRemoved) removedAny = true;
  }
  if (removedAny) {
    console.log(kleur.green("✔ shell completions uninstalled"));
  } else {
    console.log(kleur.dim("shell completions were not installed."));
  }
};
