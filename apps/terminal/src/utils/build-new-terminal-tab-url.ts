import { FRESH_SESSION_QUERY_PARAM } from "@/utils/fresh-session-query-param";
import { INITIAL_COMMAND_QUERY_PARAM } from "@/utils/remove-initial-command-query-param";
import { CWD_QUERY_PARAM, SHELL_QUERY_PARAM } from "@/utils/build-terminal-websocket-url";
import { loadStoredDefaultCwd } from "@/utils/stored-default-cwd";
import { loadStoredDefaultShell } from "@/utils/stored-default-shell";

export const buildNewTerminalTabUrl = (cwd: string | null, command?: string): string => {
  const url = new URL(window.location.origin);
  // Inherit the live cwd when available; otherwise seed from the saved default
  // so a new tab opened before any session connects still lands in the
  // user's chosen directory rather than the home directory.
  const resolvedCwd = cwd ?? loadStoredDefaultCwd();
  if (resolvedCwd) url.searchParams.set(CWD_QUERY_PARAM, resolvedCwd);
  // Seed the saved default shell so a new tab spawns the user's chosen shell
  // (the address-bar ?shell= from a programmatic launch is inherited via the
  // search params below).
  const savedShell = loadStoredDefaultShell();
  if (savedShell) url.searchParams.set(SHELL_QUERY_PARAM, savedShell);
  if (command) url.searchParams.set(INITIAL_COMMAND_QUERY_PARAM, command);
  // Prevent mobile's bare-launch resume from replacing this explicit spawn.
  url.searchParams.set(FRESH_SESSION_QUERY_PARAM, "1");
  return url.toString();
};
