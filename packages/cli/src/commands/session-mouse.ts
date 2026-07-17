import kleur from "kleur";
import { fetchSessionApi } from "./session-api.js";
import { shortSessionId } from "../utils/short-session-id.js";

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
  console.log(kleur.green(`✓ mouse [${result.mode}]${at}${label} on ${shortSessionId(id)}`));
};

const parseButton = (raw: string): "left" | "middle" | "right" => {
  if (raw === "middle" || raw === "right") return raw;
  return "left";
};

// `localterm session mouse click <id>` — by --col/--row or --on-text.
export const runSessionMouseClick = async (
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
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/mouse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response) return;
  renderMouseResult(id, (await response.json()) as MouseResult, options.json);
};

// `localterm session mouse drag <id>` — drag from --from to --to.
export const runSessionMouseDrag = async (
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
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/mouse`, {
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
export const runSessionMouseMove = async (
  id: string,
  options: { col: number; row: number; json: boolean },
): Promise<void> => {
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/mouse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "move", col: options.col, row: options.row }),
  });
  if (!response) return;
  renderMouseResult(id, (await response.json()) as MouseResult, options.json);
};

// `localterm session mouse scroll <id> up|down`.
export const runSessionMouseScroll = async (
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
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/mouse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response) return;
  renderMouseResult(id, (await response.json()) as MouseResult, options.json);
};

// `localterm session mouse state <id>` — mouse tracking + viewport size.
export const runSessionMouseState = async (id: string): Promise<void> => {
  const response = await fetchSessionApi(`/sessions/${encodeURIComponent(id)}/mouse/state`, {});
  if (!response) return;
  const state = (await response.json()) as MouseState;
  console.log(
    `${kleur.green("✓")} mouse ${state.enabled ? kleur.green("enabled") : kleur.dim("disabled")} · ${state.cols}×${state.rows}`,
  );
};
