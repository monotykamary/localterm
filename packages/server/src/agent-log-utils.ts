import {
  AUTOMATION_SESSION_TOOL_MAX_BYTES,
  AUTOMATION_SESSION_TOOL_MAX_LINES,
  MAX_AUTOMATION_FINDINGS_LENGTH,
  MAX_AUTOMATION_LOG_ENTRIES,
  MAX_AUTOMATION_LOG_LENGTH,
  MAX_AUTOMATION_TOOL_INPUT_LENGTH,
  MAX_AUTOMATION_TOOL_RESULT_LENGTH,
} from "./constants.js";
import type { AgentLogEntry } from "./types.js";

const FINDINGS_TRUNCATION_MARKER = "\n…[truncated]";
const LOG_TRUNCATION_MARKER = "\n…[log truncated]";

const truncate = (raw: string, max: number, marker: string): string | null => {
  if (raw.length === 0) return null;
  // Slice below `max` by the marker length so the result (text + marker) fits
  // the schema's `.max(max)` — otherwise the stored value exceeds the cap and
  // the file fails to load next time.
  return raw.length > max ? raw.slice(0, Math.max(0, max - marker.length)) + marker : raw;
};

export const truncateFindings = (raw: string): string | null =>
  truncate(raw, MAX_AUTOMATION_FINDINGS_LENGTH, FINDINGS_TRUNCATION_MARKER);

export const truncateLog = (raw: string): string | null =>
  truncate(raw, MAX_AUTOMATION_LOG_LENGTH, LOG_TRUNCATION_MARKER);

export const extractAssistantText = (message: { content?: unknown } | null): string => {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block): block is { type: "text"; text: string } => {
      const blockType = (block as { type?: string } | null)?.type;
      return blockType === "text";
    })
    .map((block) => block.text)
    .join("");
};

// The assistant's reasoning blocks, concatenated. Hidden by default in the UI
// (behind a "show thinking" toggle) since it's noisy but sometimes useful.
export const extractAssistantThinking = (message: { content?: unknown } | null): string => {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block): block is { type: "thinking"; thinking: string } => {
      const blockType = (block as { type?: string } | null)?.type;
      return blockType === "thinking";
    })
    .map((block) => block.thinking)
    .join("");
};

const TOOL_RESULT_TRUNCATION_MARKER = "…[truncated]";
const TOOL_INPUT_TRUNCATION_MARKER = "…";
const SESSION_TOOL_TRUNCATION_MARKER = "\n…[output truncated]";

// Format a tool call's arguments as a short header string (the path a read
// took, the command bash ran, the pattern grep searched). Mirrors pi's per-tool
// render (read shows the path, bash the command) with a generic fallback.
export const formatToolInput = (args: unknown): string => {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const command = record.command;
  if (typeof command === "string") return command;
  const filePath = record.file_path ?? record.path;
  const pattern = record.pattern;
  if (typeof pattern === "string")
    return typeof filePath === "string" ? `${pattern} · ${filePath}` : pattern;
  if (typeof filePath === "string") return filePath;
  try {
    const json = JSON.stringify(args);
    return json === "{}" ? "" : json;
  } catch {
    return "";
  }
};

export const truncateToolInput = (raw: string): string =>
  raw.length > MAX_AUTOMATION_TOOL_INPUT_LENGTH
    ? raw.slice(
        0,
        Math.max(0, MAX_AUTOMATION_TOOL_INPUT_LENGTH - TOOL_INPUT_TRUNCATION_MARKER.length),
      ) + TOOL_INPUT_TRUNCATION_MARKER
    : raw;

// Safety-net cap for a session-transcript tool result, matching pi core's
// tool-output truncation (2000 lines or 50 KB, head kept). The session file is
// already pi-truncated, so this rarely fires.
export const capSessionToolResult = (raw: string): string => {
  const lines = raw.split("\n");
  let out = raw;
  if (lines.length > AUTOMATION_SESSION_TOOL_MAX_LINES)
    out = lines.slice(0, AUTOMATION_SESSION_TOOL_MAX_LINES).join("\n");
  if (out.length > AUTOMATION_SESSION_TOOL_MAX_BYTES)
    out = out.slice(0, AUTOMATION_SESSION_TOOL_MAX_BYTES);
  return out === raw ? raw : out + SESSION_TOOL_TRUNCATION_MARKER;
};

export const truncateToolResult = (raw: string): string =>
  raw.length > MAX_AUTOMATION_TOOL_RESULT_LENGTH
    ? raw.slice(
        0,
        Math.max(0, MAX_AUTOMATION_TOOL_RESULT_LENGTH - TOOL_RESULT_TRUNCATION_MARKER.length),
      ) + TOOL_RESULT_TRUNCATION_MARKER
    : raw;

const entrySize = (entry: AgentLogEntry): number => {
  let size = entry.text.length;
  if (entry.type === "assistant" && entry.thinking) size += entry.thinking.length;
  if (entry.type === "tool") size += entry.name.length;
  return size;
};

// Bound the structured log: cap the entry count, then drop oldest entries
// until the total is under the byte cap (keeps the recent turns, which hold
// the final answer). User/assistant text is kept full per entry; only the
// total is bounded for storage.
export const capLogEntries = (entries: AgentLogEntry[]): AgentLogEntry[] => {
  let trimmed =
    entries.length > MAX_AUTOMATION_LOG_ENTRIES
      ? entries.slice(entries.length - MAX_AUTOMATION_LOG_ENTRIES)
      : entries;
  let total = trimmed.reduce((sum, entry) => sum + entrySize(entry), 0);
  while (total > MAX_AUTOMATION_LOG_LENGTH && trimmed.length > 1) {
    total -= entrySize(trimmed[0]);
    trimmed = trimmed.slice(1);
  }
  return trimmed;
};

// Extract the text of a tool_result content block: it's either a plain string
// or an array of content blocks (Anthropic's tool_result.content shape).
export const extractToolResultText = (part: { content?: unknown }): string => {
  const content = part.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: "text"; text: string } => {
        const blockType = (block as { type?: string } | null)?.type;
        return blockType === "text";
      })
      .map((block) => block.text)
      .join("");
  }
  return "";
};
