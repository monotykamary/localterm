import { INITIAL_COMMAND_QUERY_PARAM } from "@/utils/remove-initial-command-query-param";
import { RUN_QUERY_PARAM } from "@/utils/remove-run-query-param";
import { SESSION_ID_QUERY_PARAM } from "@/utils/sync-session-id-query-param";
import { loadStoredDefaultCwd } from "@/utils/stored-default-cwd";
import { loadStoredDefaultShell } from "@/utils/stored-default-shell";
import { WINDOW_ID_QUERY_PARAM, loadWindowId } from "@/utils/window-id";

export const CWD_QUERY_PARAM = "cwd";
export const SHELL_QUERY_PARAM = "shell";

interface BuildTerminalWebSocketUrlOptions {
  cwdOverride?: string | null;
  sid?: string | null;
  omitAddressBarSessionId?: boolean;
}

export const buildTerminalWebSocketUrl = ({
  cwdOverride,
  sid,
  omitAddressBarSessionId = false,
}: BuildTerminalWebSocketUrlOptions = {}): string => {
  const url = new URL("/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams(window.location.search);
  // The address-bar ?cwd= (or an explicit override like the live cwd on
  // reconnect) wins; a bare launch with neither falls back to the user's
  // saved default cwd so the PWA app icon and a fresh tab open somewhere
  // meaningful instead of always the home directory.
  const cwd = cwdOverride ?? params.get(CWD_QUERY_PARAM) ?? loadStoredDefaultCwd();
  if (cwd) url.searchParams.set(CWD_QUERY_PARAM, cwd);
  // The saved default shell override (Settings → Launch) seeds every fresh
  // spawn with the user's chosen shell; an address-bar ?shell= wins (a
  // programmatic launch can target a specific shell). Empty = the daemon's
  // detected login shell (no param sent).
  const shell = params.get(SHELL_QUERY_PARAM) ?? loadStoredDefaultShell();
  if (shell) url.searchParams.set(SHELL_QUERY_PARAM, shell);
  const runId = params.get(RUN_QUERY_PARAM);
  if (runId) url.searchParams.set(RUN_QUERY_PARAM, runId);
  // Fall back to the address bar's ?sid= (written by syncSessionIdQueryParam)
  // when no explicit id is passed, so a full page refresh reattaches to the
  // same live PTY instead of spawning a fresh shell. An in-place fresh switch
  // explicitly suppresses this fallback while preserving the address bar until
  // the replacement session lands.
  const resolvedSid = sid ?? (omitAddressBarSessionId ? null : params.get(SESSION_ID_QUERY_PARAM));
  if (resolvedSid) url.searchParams.set(SESSION_ID_QUERY_PARAM, resolvedSid);
  // The per-browser-profile handle so the daemon can group this tab with the
  // others of the same profile in the session picker's peer display. Minted
  // once into localStorage (partitioned per profile), so every tab of one
  // profile carries the same id.
  const windowId = loadWindowId();
  if (windowId) url.searchParams.set(WINDOW_ID_QUERY_PARAM, windowId);
  // Forward a transient initial command (a worktree's setup script) so the
  // server writes it to the PTY as if the user typed it — the install/env-copy
  // output is visible and the prompt returns when it finishes.
  const initialCommand = params.get(INITIAL_COMMAND_QUERY_PARAM);
  if (initialCommand) url.searchParams.set(INITIAL_COMMAND_QUERY_PARAM, initialCommand);
  return url.toString();
};
