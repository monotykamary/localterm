import fs from "node:fs";
import {
  capSessionToolResult,
  extractToolResultText,
  formatToolInput,
  truncateToolInput,
} from "./agent-log-utils.js";
import type { AgentSessionEntry } from "./types.js";

// Read a thread-mode pi session file (JSONL) and flatten it into the same
// user/assistant/tool entry shape as a run log, plus a `compaction` entry for
// each compaction the branch went through. Tool calls are tracked by id so a
// tool result's name + input (the path/command) can be recovered from the
// preceding call. Session-transcript tool results are capped at pi core's
// limits (2000 lines / 50 KB), not the stored-log preview cap. `untilMs`
// truncates the transcript at a point in time (a run's finishedAt) so an older
// run shows the branch as it was then, not the latest state. Returns [] if the
// file is missing (fresh mode, or no runs yet).
export const readAgentSession = async (
  sessionFile: string,
  untilMs?: number,
): Promise<AgentSessionEntry[]> => {
  let raw: string;
  try {
    raw = await fs.promises.readFile(sessionFile, "utf8");
  } catch {
    return [];
  }
  const toolNameById = new Map<string, string>();
  const toolInputById = new Map<string, string>();
  const entries: AgentSessionEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      untilMs !== undefined &&
      typeof event.timestamp === "string" &&
      Date.parse(event.timestamp) > untilMs
    ) {
      continue;
    }
    if (event.type === "message") {
      const message = event.message as { role?: string; content?: unknown } | null;
      if (!message) continue;
      const role = message.role;
      const content = Array.isArray(message.content) ? message.content : [];
      if (role === "user") {
        for (const part of content) {
          const block = part as {
            type?: string;
            text?: unknown;
            tool_use_id?: unknown;
            content?: unknown;
          };
          if (block.type === "text" && typeof block.text === "string") {
            entries.push({ type: "user", text: block.text });
          } else if (block.type === "tool_result") {
            const id = String(block.tool_use_id ?? "");
            const name = toolNameById.get(id) ?? "tool";
            const input = toolInputById.get(id);
            entries.push({
              type: "tool",
              name,
              ...(input !== undefined ? { input } : {}),
              text: capSessionToolResult(extractToolResultText(block)),
            });
          }
        }
      } else if (role === "toolResult") {
        const message2 = event.message as {
          toolCallId?: unknown;
          toolName?: unknown;
          content?: unknown;
        } | null;
        const id = String(message2?.toolCallId ?? "");
        const name =
          (typeof message2?.toolName === "string" && message2.toolName) ||
          toolNameById.get(id) ||
          "tool";
        const input = toolInputById.get(id);
        entries.push({
          type: "tool",
          name,
          ...(input !== undefined ? { input } : {}),
          text: capSessionToolResult(extractToolResultText(message2 ?? {})),
        });
      } else if (role === "assistant") {
        let text = "";
        let thinking = "";
        for (const part of content) {
          const block = part as {
            type?: string;
            text?: unknown;
            thinking?: unknown;
            id?: unknown;
            name?: unknown;
            arguments?: unknown;
            input?: unknown;
          };
          if (block.type === "text" && typeof block.text === "string") text += block.text;
          else if (block.type === "thinking" && typeof block.thinking === "string")
            thinking += block.thinking;
          else if (block.type === "tool_use" || block.type === "toolCall") {
            const callId = String(block.id ?? "");
            const callName = String(block.name ?? "tool");
            toolNameById.set(callId, callName);
            const formatted = truncateToolInput(formatToolInput(block.arguments ?? block.input));
            if (formatted) toolInputById.set(callId, formatted);
          }
        }
        if (text.length > 0 || thinking.length > 0) {
          entries.push(
            thinking.length > 0
              ? { type: "assistant", text, thinking }
              : { type: "assistant", text },
          );
        }
      }
    } else if (event.type === "compaction") {
      const summary = String(event.summary ?? "");
      const tokensBefore = typeof event.tokensBefore === "number" ? event.tokensBefore : undefined;
      entries.push(
        tokensBefore !== undefined
          ? { type: "compaction", summary, tokensBefore }
          : { type: "compaction", summary },
      );
    }
  }
  return entries;
};
