import kleur from "kleur";
import { writeFile } from "node:fs/promises";
import open from "open";
import {
  MILLISECONDS_PER_SECOND,
  SESSION_MAX_EXIT_CODE,
  SESSION_SHORT_ID_LENGTH,
  SESSION_TIMEOUT_EXIT_CODE,
} from "../constants.js";
import { daemonBaseUrl, daemonFetch, reportDaemonDown } from "../utils/daemon-api.js";
import { shortSessionId } from "../utils/short-session-id.js";
import { fetchSessionApi } from "./session-api.js";
import { resolveSessionId } from "./resolve-session-id.js";
import {
  runSessionMouseClick as runMouseClick,
  runSessionMouseDrag as runMouseDrag,
  runSessionMouseMove as runMouseMove,
  runSessionMouseScroll as runMouseScroll,
  runSessionMouseState as runMouseState,
} from "./session-mouse.js";
import { resolveDaemonUrl } from "../utils/portless.js";
import { readPort } from "../state.js";

interface SessionListItem {
  id: string;
  pid: number;
  shell: string;
  shellName: string;
  cwd: string;
  title: string;
  createdAt: number;
  lastOutputAt: number;
  clients: number;
  state: string;
  pinned: boolean;
}

interface ExecResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

const stateColor = (state: string): string => {
  switch (state) {
    case "running":
      return kleur.green(state);
    case "alive-quiet":
      return kleur.cyan(state);
    default:
      return kleur.dim(state);
  }
};

// Interpret C-style escapes in send-keys input so an agent can write
// `send-keys <id> 'ls\n'` (execute) or `send-keys <id> '\x03'` (Ctrl-C) without
// embedding raw control bytes in argv. `\n` maps to `\r` (the PTY's line
// terminator); other escapes pass through verbatim.
const unescapeKeys = (raw: string): string => {
  let result = "";
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char !== "\\" || index === raw.length - 1) {
      result += char;
      continue;
    }
    const next = raw[index + 1];
    switch (next) {
      case "n":
        result += "\r";
        index++;
        break;
      case "r":
        result += "\r";
        index++;
        break;
      case "t":
        result += "\t";
        index++;
        break;
      case "x": {
        const hex = raw.slice(index + 2, index + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          result += String.fromCharCode(Number.parseInt(hex, 16));
          index += 3;
        } else {
          result += next;
          index++;
        }
        break;
      }
      case "\\":
        result += "\\";
        index++;
        break;
      default:
        result += next;
        index++;
    }
  }
  return result;
};

const secondsToMs = (seconds: number): number => seconds * MILLISECONDS_PER_SECOND;

const withResolvedSessionId =
  <CommandArguments extends unknown[]>(
    runCommand: (id: string, ...commandArguments: CommandArguments) => Promise<void>,
  ) =>
  async (idOrPrefix: string, ...commandArguments: CommandArguments): Promise<void> => {
    const id = await resolveSessionId(idOrPrefix);
    if (!id) return;
    await runCommand(id, ...commandArguments);
  };

const renderExecResult = (result: ExecResult, json: boolean): void => {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (result.output) process.stdout.write(result.output);
  if (result.timedOut) {
    console.error(
      kleur.yellow(
        `\n[timed out after ${Math.round(result.durationMs / MILLISECONDS_PER_SECOND)}s]`,
      ),
    );
    process.exitCode = SESSION_TIMEOUT_EXIT_CODE;
    return;
  }
  if (result.truncated) console.error(kleur.dim("\n[output truncated]"));
  process.exitCode =
    result.exitCode === null ? 1 : Math.min(result.exitCode, SESSION_MAX_EXIT_CODE);
};

// `localterm session ls [--json]` — every live PTY (attached, dormant, or
// programmatic/pinned). The `pinned` column marks REST-created sessions exempt
// from idle reap.
const runList = async (options: { json: boolean }): Promise<void> => {
  const response = await fetchSessionApi("/sessions", {});
  if (!response) return;
  const body = (await response.json()) as { sessions: SessionListItem[] };
  if (options.json) {
    console.log(JSON.stringify(body.sessions));
    return;
  }
  if (body.sessions.length === 0) {
    console.log(kleur.dim("no sessions. open a tab, or `localterm session new`."));
    return;
  }
  const idWidth = SESSION_SHORT_ID_LENGTH;
  console.log(
    `${"ID".padEnd(idWidth)}  ${"PID".padStart(7)}  STATE        PIN  C  SHELL       CWD / TITLE`,
  );
  console.log(
    `${"─".repeat(idWidth)}  ${"─".repeat(7)}  ───────────  ───  ─  ─────────  ─────────────────────────────`,
  );
  for (const session of body.sessions) {
    const pin = session.pinned ? kleur.yellow("●") : kleur.dim("·");
    console.log(
      `${kleur.cyan(shortSessionId(session.id).padEnd(idWidth))}  ${String(session.pid).padStart(7)}  ${stateColor(session.state).padEnd(12)}  ${pin}  ${String(session.clients).padStart(1)}  ${session.shellName.padEnd(10)}  ${kleur.dim(session.cwd)} ${kleur.dim(`· ${session.title}`)}`,
    );
  }
};

// `localterm session current [--json]` — self-reference: the id of the localterm
// session this process is running in. The daemon injects LOCALTERM_SESSION_ID
// into every PTY's env at spawn (inherited by all child processes), so a call
// inside a tab resolves to its own session without scanning `session ls`.
// Degrades to the bare id when the daemon is down; a non-live id (stale/spoofed
// env) is reported and exits 1.
const runCurrent = async (options: { json: boolean }): Promise<void> => {
  const id = process.env.LOCALTERM_SESSION_ID;
  if (!id) {
    if (options.json) {
      console.log(JSON.stringify({ error: "not_in_session" }));
    } else {
      console.log(kleur.red("✗ not running inside a localterm session"));
      console.log(
        kleur.dim("  env.LOCALTERM_SESSION_ID is set when a shell is spawned in a localterm PTY"),
      );
    }
    process.exitCode = 1;
    return;
  }
  let response: Response | null;
  try {
    const base = daemonBaseUrl();
    response = await daemonFetch(`${base}/sessions/${encodeURIComponent(id)}`);
  } catch {
    response = null;
  }
  if (response === null) {
    if (options.json) {
      console.log(JSON.stringify({ id }));
    } else {
      console.log(`${kleur.cyan(shortSessionId(id))}  ${kleur.dim("(daemon unreachable)")}`);
      console.log(kleur.dim(`  ${id}`));
    }
    return;
  }
  if (!response.ok) {
    if (options.json) {
      console.log(JSON.stringify({ id, live: false }));
    } else {
      console.log(`${kleur.cyan(shortSessionId(id))}  ${kleur.red("(not a live session)")}`);
      console.log(kleur.dim(`  ${id}`));
    }
    process.exitCode = 1;
    return;
  }
  const body = (await response.json()) as { session: SessionListItem };
  const session = body.session;
  if (options.json) {
    console.log(JSON.stringify(session));
    return;
  }
  console.log(
    `${kleur.green("✓")} ${kleur.cyan(shortSessionId(session.id))}  ${session.shellName}  ${kleur.dim(session.cwd)}  ${stateColor(session.state)}  ${kleur.dim(`· ${session.clients} client(s)`)}`,
  );
};

// `localterm session new` — spawn a detached PTY. Pinned by default so an
// agent's shell survives between calls; `--no-pin` enters the grace window.
// Prints the session id (or the full session object with `--json`).
const runNew = async (options: {
  cwd?: string;
  cmd?: string;
  name?: string;
  shell?: string;
  cols?: number;
  rows?: number;
  pin: boolean;
  json: boolean;
}): Promise<void> => {
  const response = await fetchSessionApi("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cwd: options.cwd,
      command: options.cmd,
      name: options.name,
      shell: options.shell,
      cols: options.cols,
      rows: options.rows,
      pinned: options.pin,
    }),
  });
  if (!response) return;
  const body = (await response.json()) as { session: SessionListItem };
  if (options.json) {
    console.log(JSON.stringify(body.session));
    return;
  }
  console.log(
    kleur.green(`✓ session ${shortSessionId(body.session.id)} (${body.session.shellName})`),
  );
  console.log(kleur.dim(`  cwd: ${body.session.cwd}`));
  console.log(
    kleur.dim(
      `  pin: ${body.session.pinned ? "yes (exempt from idle reap)" : "no (reaped when idle)"}`,
    ),
  );
};

// `localterm session kill <id>` — tear down the PTY (and its shell).
const runKill = async (id: string): Promise<void> => {
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response) return;
  console.log(kleur.green(`✓ killed session ${shortSessionId(id)}`));
};

// `localterm session send-keys <id> <keys>` — write raw input to a session.
// C-style escapes are interpreted (`\n` → Enter, `\x03` → Ctrl-C). For a
// blocking command+output+exit in one call, use `localterm session exec`.
const runSendKeys = async (id: string, keys: string): Promise<void> => {
  const data = unescapeKeys(keys);
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!response) return;
  console.log(kleur.green(`✓ sent ${data.length} byte(s) to ${shortSessionId(id)}`));
};

// `localterm session capture <id> [--lines N] [--png -o file] [--json]` — the
// rendered screen as clean text (ANSI processed), or a PNG screenshot of the
// terminal rasterized by the browser over the daemon's CDP socket. `--json`
// wraps text as `{"text":"..."}` (or `{"path","bytes"}` for --png).
const runCapture = async (
  id: string,
  options: { lines?: number; png?: boolean; output?: string; json: boolean },
): Promise<void> => {
  if (options.png) {
    const params = new URLSearchParams({ format: "png" });
    if (options.lines) params.set("lines", String(options.lines));
    const response = await fetchSessionApi(
      `/sessions/${encodeURIComponent(id)}/pane?${params.toString()}`,
      {},
    );
    if (!response) return;
    if (!response.ok) return;
    const buffer = Buffer.from(await response.arrayBuffer());
    const file = options.output ?? `pane-${id.slice(0, 8)}-${Date.now()}.png`;
    await writeFile(file, buffer);
    if (options.json) {
      console.log(JSON.stringify({ path: file, bytes: buffer.length }));
    } else {
      console.log(kleur.green(`✓ wrote ${file} (${buffer.length} bytes)`));
    }
    return;
  }
  const query = options.lines ? `?lines=${options.lines}` : "";
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/pane${query}`, {});
  if (!response) return;
  const body = (await response.json()) as { text: string };
  if (options.json) {
    console.log(JSON.stringify(body));
    return;
  }
  process.stdout.write(body.text);
  if (body.text && !body.text.endsWith("\n")) process.stdout.write("\n");
};

// `localterm session press <id> <keys...>` — send named keys (F2, Enter,
// Ctrl-C, Escape : w q Enter, or literal text). Resolves server-side to xterm
// bytes over the same /input route.
const runPress = async (id: string, keys: string[]): Promise<void> => {
  const data = keys.join(" ");
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data, named: true }),
  });
  if (!response) return;
  console.log(kleur.green(`✓ pressed ${kleur.dim(JSON.stringify(data))} on ${shortSessionId(id)}`));
};

interface WaitResult {
  matched: boolean;
  elapsedMs: number;
  snapshot: string;
}

// `localterm session wait <id> ...` — block until the pane matches --text /
// --regex, or goes --idle for --idle-ms. Exits 0 on match, 1 on timeout.
const runWait = async (
  id: string,
  options: {
    text?: string;
    regex?: string;
    idleMs?: number;
    timeout?: number;
    caseSensitive?: boolean;
    json: boolean;
  },
): Promise<void> => {
  const body: Record<string, unknown> = {};
  if (options.text !== undefined) {
    body.mode = "text";
    body.text = options.text;
    if (options.caseSensitive) body.caseSensitive = true;
  } else if (options.regex !== undefined) {
    body.mode = "regex";
    body.regex = options.regex;
  } else {
    body.mode = "idle";
    if (options.idleMs !== undefined) body.idleMs = options.idleMs;
  }
  if (options.timeout) body.timeoutMs = secondsToMs(options.timeout);
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/wait`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response) return;
  const result = (await response.json()) as WaitResult;
  if (options.json) {
    console.log(JSON.stringify(result));
  } else if (result.matched) {
    console.log(kleur.green(`✓ matched in ${result.elapsedMs}ms`));
  } else {
    console.log(kleur.yellow(`✗ timed out after ${result.elapsedMs}ms`));
  }
  process.exitCode = result.matched ? 0 : 1;
};

// `localterm session exec <id> <command> [--timeout s] [--json]` — run a single
// command line in a persistent session, capture its output, return the exit
// code. Text mode prints output and exits with the command's code; `--json`
// prints the result object and exits 0 (the exit code is in the JSON).
const runExec = async (
  id: string,
  command: string,
  options: { timeout?: number; json: boolean },
): Promise<void> => {
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command,
      ...(options.timeout ? { timeoutMs: secondsToMs(options.timeout) } : {}),
    }),
  });
  if (!response) return;
  const result = (await response.json()) as ExecResult;
  renderExecResult(result, options.json);
};

// `localterm session resize <id> --cols N --rows N`.
const runResize = async (id: string, options: { cols: number; rows: number }): Promise<void> => {
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/resize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cols: options.cols, rows: options.rows }),
  });
  if (!response) return;
  console.log(kleur.green(`✓ resized ${shortSessionId(id)} → ${options.cols}×${options.rows}`));
};

// `localterm session rename <id> <name>` — set the title (the shell may
// overwrite it on its next title/cwd change).
const runRename = async (id: string, name: string): Promise<void> => {
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response) return;
  console.log(kleur.green(`✓ renamed ${shortSessionId(id)} → ${name}`));
};

// `localterm session pin <id>` / `unpin <id>` — toggle idle-reap exemption.
const runSetPin = async (id: string, pinned: boolean): Promise<void> => {
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  if (!response) return;
  console.log(kleur.green(`✓ ${pinned ? "pinned" : "unpinned"} ${shortSessionId(id)}`));
};

// `localterm exec [--cwd] [--timeout s] [--json] <command>` — one-shot: spawn a
// transient shell, run the command, capture, kill the shell. Self-contained,
// no session bookkeeping. Same exit-code propagation as `session exec`.
const runOneShotExecImpl = async (
  command: string,
  options: {
    cwd?: string;
    shell?: string;
    cols?: number;
    rows?: number;
    timeout?: number;
    json: boolean;
  },
): Promise<void> => {
  const response = await fetchSessionApi("/exec", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command,
      cwd: options.cwd,
      shell: options.shell,
      cols: options.cols,
      rows: options.rows,
      ...(options.timeout ? { timeoutMs: secondsToMs(options.timeout) } : {}),
    }),
  });
  if (!response) return;
  const result = (await response.json()) as ExecResult;
  renderExecResult(result, options.json);
};

// `localterm session attach <id>` — open a browser tab onto a live PTY by id.
// No REST needed (attaching is the browser's job); this just resolves the
// daemon's surface URL and opens it with `?sid=` so the WS attaches to the
// existing shell instead of spawning a fresh one. Opens at the daemon-local
// surface (`localUrl`: portless https://localterm.localhost, else loopback)
// for the same reason automation run tabs do — `session attach` opens in the
// daemon's own browser, where a flapping `tailscale serve` (laptop wake, DERP
// relay, cert renewal) would fail the tab load, so it never rides the tailnet
// even when `resolveDaemonUrl` picks the tailnet URL as the remote `url`.
const runAttach = async (id: string): Promise<void> => {
  const port = readPort();
  if (!port) {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const resolved = await resolveDaemonUrl(port);
  const url = new URL(resolved.localUrl ?? resolved.url);
  url.searchParams.set("sid", id);
  await open(url.href);
  console.log(kleur.green(`✓ opening ${shortSessionId(id)} at ${url.href}`));
};

export const runSessionList = runList;
export const runSessionCurrent = runCurrent;
export const runSessionNew = runNew;
export const runSessionKill = withResolvedSessionId(runKill);
export const runSessionSendKeys = withResolvedSessionId(runSendKeys);
export const runSessionCapture = withResolvedSessionId(runCapture);
export const runSessionExec = withResolvedSessionId(runExec);
export const runSessionResize = withResolvedSessionId(runResize);
export const runSessionRename = withResolvedSessionId(runRename);
export const runSessionPin = withResolvedSessionId(runSetPin);
export const runSessionAttach = withResolvedSessionId(runAttach);
export const runSessionPress = withResolvedSessionId(runPress);
export const runSessionWait = withResolvedSessionId(runWait);
export const runSessionMouseClick = withResolvedSessionId(runMouseClick);
export const runSessionMouseDrag = withResolvedSessionId(runMouseDrag);
export const runSessionMouseMove = withResolvedSessionId(runMouseMove);
export const runSessionMouseScroll = withResolvedSessionId(runMouseScroll);
export const runSessionMouseState = withResolvedSessionId(runMouseState);
export const runOneShotExec = runOneShotExecImpl;
