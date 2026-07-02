import kleur from "kleur";
import { writeFile } from "node:fs/promises";
import open from "open";
import {
  daemonBaseUrl,
  daemonFetch,
  reportApiError,
  reportDaemonDown,
} from "../utils/daemon-api.js";
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

const MAX_EXIT_CODE = 255;
const TIMEOUT_EXIT_CODE = 124;

const fetchOrReport = async (path: string, init: RequestInit): Promise<Response | null> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return null;
  }
  const response = await daemonFetch(`${base}${path}`, init);
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return null;
  }
  return response;
};

const shortId = (id: string): string => id.slice(0, 8);

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

const secondsToMs = (seconds: number): number => seconds * 1000;

const renderExecResult = (result: ExecResult, json: boolean): void => {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (result.output) process.stdout.write(result.output);
  if (result.timedOut) {
    console.error(kleur.yellow(`\n[timed out after ${Math.round(result.durationMs / 1000)}s]`));
    process.exitCode = TIMEOUT_EXIT_CODE;
    return;
  }
  if (result.truncated) console.error(kleur.dim("\n[output truncated]"));
  process.exitCode = result.exitCode === null ? 1 : Math.min(result.exitCode, MAX_EXIT_CODE);
};

// `localterm session ls [--json]` — every live PTY (attached, dormant, or
// programmatic/pinned). The `pinned` column marks REST-created sessions exempt
// from idle reap.
const runList = async (options: { json: boolean }): Promise<void> => {
  const response = await fetchOrReport("/sessions", {});
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
  const idWidth = 8;
  console.log(
    `${"ID".padEnd(idWidth)}  ${"PID".padStart(7)}  STATE        PIN  C  SHELL       CWD / TITLE`,
  );
  console.log(
    `${"─".repeat(idWidth)}  ${"─".repeat(7)}  ───────────  ───  ─  ─────────  ─────────────────────────────`,
  );
  for (const session of body.sessions) {
    const pin = session.pinned ? kleur.yellow("●") : kleur.dim("·");
    console.log(
      `${kleur.cyan(shortId(session.id).padEnd(idWidth))}  ${String(session.pid).padStart(7)}  ${stateColor(session.state).padEnd(12)}  ${pin}  ${String(session.clients).padStart(1)}  ${session.shellName.padEnd(10)}  ${kleur.dim(session.cwd)} ${kleur.dim(`· ${session.title}`)}`,
    );
  }
};

// `localterm session new` — spawn a detached PTY. Pinned by default so an
// agent's shell survives between calls; `--no-pin` enters the grace window.
// Prints the session id (or the full session object with `--json`).
const runNew = async (options: {
  cwd?: string;
  cmd?: string;
  name?: string;
  cols?: number;
  rows?: number;
  pin: boolean;
  json: boolean;
}): Promise<void> => {
  const response = await fetchOrReport("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cwd: options.cwd,
      command: options.cmd,
      name: options.name,
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
  console.log(kleur.green(`✓ session ${shortId(body.session.id)} (${body.session.shellName})`));
  console.log(kleur.dim(`  cwd: ${body.session.cwd}`));
  console.log(
    kleur.dim(
      `  pin: ${body.session.pinned ? "yes (exempt from idle reap)" : "no (reaped when idle)"}`,
    ),
  );
};

// `localterm session kill <id>` — tear down the PTY (and its shell).
const runKill = async (id: string): Promise<void> => {
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response) return;
  console.log(kleur.green(`✓ killed session ${shortId(id)}`));
};

// `localterm session send-keys <id> <keys>` — write raw input to a session.
// C-style escapes are interpreted (`\n` → Enter, `\x03` → Ctrl-C). For a
// blocking command+output+exit in one call, use `localterm session exec`.
const runSendKeys = async (id: string, keys: string): Promise<void> => {
  const data = unescapeKeys(keys);
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!response) return;
  console.log(kleur.green(`✓ sent ${data.length} byte(s) to ${shortId(id)}`));
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
    const response = await fetchOrReport(
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
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/pane${query}`, {});
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
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data, named: true }),
  });
  if (!response) return;
  console.log(kleur.green(`✓ pressed ${kleur.dim(JSON.stringify(data))} on ${shortId(id)}`));
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
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/wait`, {
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
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/exec`, {
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
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/resize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cols: options.cols, rows: options.rows }),
  });
  if (!response) return;
  console.log(kleur.green(`✓ resized ${shortId(id)} → ${options.cols}×${options.rows}`));
};

// `localterm session rename <id> <name>` — set the title (the shell may
// overwrite it on its next title/cwd change).
const runRename = async (id: string, name: string): Promise<void> => {
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response) return;
  console.log(kleur.green(`✓ renamed ${shortId(id)} → ${name}`));
};

// `localterm session pin <id>` / `unpin <id>` — toggle idle-reap exemption.
const runSetPin = async (id: string, pinned: boolean): Promise<void> => {
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  if (!response) return;
  console.log(kleur.green(`✓ ${pinned ? "pinned" : "unpinned"} ${shortId(id)}`));
};

// `localterm exec [--cwd] [--timeout s] [--json] <command>` — one-shot: spawn a
// transient shell, run the command, capture, kill the shell. Self-contained,
// no session bookkeeping. Same exit-code propagation as `session exec`.
const runOneShotExecImpl = async (
  command: string,
  options: { cwd?: string; cols?: number; rows?: number; timeout?: number; json: boolean },
): Promise<void> => {
  const response = await fetchOrReport("/exec", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command,
      cwd: options.cwd,
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
// existing shell instead of spawning a fresh one.
const runAttach = async (id: string): Promise<void> => {
  const port = readPort();
  if (!port) {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const resolved = await resolveDaemonUrl(port);
  const url = new URL(resolved.url);
  url.searchParams.set("sid", id);
  await open(url.href);
  console.log(kleur.green(`✓ opening ${shortId(id)} at ${url.href}`));
};

const parseInteger = (raw: string): number => Number.parseInt(raw, 10);

interface MouseResult {
  ok: boolean;
  mode: "cdp" | "sgr";
  col: number | null;
  row: number | null;
  text: string | null;
  reason: string | null;
}

interface MouseState {
  enabled: boolean;
  cols: number;
  rows: number;
}

const renderMouseResult = (id: string, result: MouseResult, json: boolean): void => {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (!result.ok) {
    const where = result.col !== null ? ` at (${result.col},${result.row})` : "";
    const label = result.text ? ` ${kleur.cyan(result.text)}` : "";
    console.error(
      kleur.red(`✗ mouse failed:${where}${label} — ${result.reason ?? "unknown"} [${result.mode}]`),
    );
    process.exitCode = 1;
    return;
  }
  const at = result.col !== null ? ` (${result.col},${result.row})` : "";
  const label = result.text ? ` ${kleur.cyan(result.text)}` : "";
  console.log(kleur.green(`✓ mouse [${result.mode}]${at}${label} on ${shortId(id)}`));
};

const parseButton = (raw: string): "left" | "middle" | "right" => {
  if (raw === "middle" || raw === "right") return raw;
  return "left";
};

// `localterm session mouse click <id>` — by --col/--row or --on-text.
const runMouseClick = async (
  id: string,
  options: {
    col?: number;
    row?: number;
    onText?: string;
    button: string;
    clicks?: number;
    json: boolean;
  },
): Promise<void> => {
  const body: Record<string, unknown> = { action: "click", button: parseButton(options.button) };
  if (options.onText !== undefined) body.onText = options.onText;
  else {
    body.col = options.col ?? 0;
    body.row = options.row ?? 0;
  }
  if (options.clicks !== undefined) body.clicks = options.clicks;
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/mouse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response) return;
  renderMouseResult(id, (await response.json()) as MouseResult, options.json);
};

// `localterm session mouse drag <id>` — drag from --from to --to.
const runMouseDrag = async (
  id: string,
  options: {
    fromCol: number;
    fromRow: number;
    toCol: number;
    toRow: number;
    button: string;
    json: boolean;
  },
): Promise<void> => {
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/mouse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "drag",
      fromCol: options.fromCol,
      fromRow: options.fromRow,
      toCol: options.toCol,
      toRow: options.toRow,
      button: parseButton(options.button),
    }),
  });
  if (!response) return;
  renderMouseResult(id, (await response.json()) as MouseResult, options.json);
};

// `localterm session mouse move <id>` — move the cursor.
const runMouseMove = async (
  id: string,
  options: { col: number; row: number; json: boolean },
): Promise<void> => {
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/mouse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "move", col: options.col, row: options.row }),
  });
  if (!response) return;
  renderMouseResult(id, (await response.json()) as MouseResult, options.json);
};

// `localterm session mouse scroll <id> up|down`.
const runMouseScroll = async (
  id: string,
  direction: string,
  options: { amount?: number; col?: number; row?: number; json: boolean },
): Promise<void> => {
  const body: Record<string, unknown> = {
    action: "scroll",
    direction: direction === "up" ? "up" : "down",
  };
  if (options.amount !== undefined) body.amount = options.amount;
  if (options.col !== undefined) body.col = options.col;
  if (options.row !== undefined) body.row = options.row;
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/mouse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response) return;
  renderMouseResult(id, (await response.json()) as MouseResult, options.json);
};

// `localterm session mouse state <id>` — mouse tracking + viewport size.
const runMouseState = async (id: string): Promise<void> => {
  const response = await fetchOrReport(`/sessions/${encodeURIComponent(id)}/mouse/state`, {});
  if (!response) return;
  const state = (await response.json()) as MouseState;
  console.log(
    `${kleur.green("✓")} mouse ${state.enabled ? kleur.green("enabled") : kleur.dim("disabled")} · ${state.cols}×${state.rows}`,
  );
};

export const runSessionList = runList;
export const runSessionNew = runNew;
export const runSessionKill = runKill;
export const runSessionSendKeys = runSendKeys;
export const runSessionCapture = runCapture;
export const runSessionExec = runExec;
export const runSessionResize = runResize;
export const runSessionRename = runRename;
export const runSessionPin = runSetPin;
export const runSessionAttach = runAttach;
export const runSessionPress = runPress;
export const runSessionWait = runWait;
export const runSessionMouseClick = runMouseClick;
export const runSessionMouseDrag = runMouseDrag;
export const runSessionMouseMove = runMouseMove;
export const runSessionMouseScroll = runMouseScroll;
export const runSessionMouseState = runMouseState;
export const runOneShotExec = runOneShotExecImpl;
export { parseInteger };
