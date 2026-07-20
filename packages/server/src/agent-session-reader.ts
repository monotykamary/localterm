import {
  AUTOMATION_SESSION_MAX_ENTRIES,
  AUTOMATION_SESSION_MAX_LINE_BYTES,
  AUTOMATION_SESSION_MAX_PENDING_TOOL_CALLS,
  AUTOMATION_SESSION_MAX_RETAINED_BYTES,
} from "./constants.js";
import {
  capSessionToolResult,
  extractToolResultText,
  formatToolInput,
  truncateToolInput,
} from "./agent-log-utils.js";
import type { AgentSessionEntry } from "./types.js";
import { readBoundedLines } from "./utils/read-bounded-lines.js";

interface PendingToolCall {
  name: string;
  input?: string;
}

interface RetainedSessionEntry {
  entry: AgentSessionEntry;
  bytes: number;
}

// Read a thread-mode pi session file (JSONL) and flatten it into the same
// user/assistant/tool entry shape as a run log, plus a compaction entry for
// each compaction the branch went through. Tool calls are tracked by id so a
// tool result's name + input (the path/command) can be recovered from the
// preceding call. Session-transcript tool results are capped at pi core's
// limits (2000 lines / 50 KB), not the stored-log preview cap. untilMs
// truncates the transcript at a point in time (a run's finishedAt) so an older
// run shows the branch as it was then, not the latest state. Returns [] if the
// file is missing (fresh mode, or no runs yet).
export const readAgentSession = async (
  sessionFile: string,
  untilMs?: number,
): Promise<AgentSessionEntry[]> => {
  const pendingToolCalls = new Map<string, PendingToolCall>();
  const retainedEntries = new Map<number, RetainedSessionEntry>();
  let nextEntryIndex = 0;
  let retainedBytes = 0;

  const appendEntry = (entry: AgentSessionEntry): void => {
    const bytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
    retainedEntries.set(nextEntryIndex, { entry, bytes });
    nextEntryIndex += 1;
    retainedBytes += bytes;
    while (
      retainedEntries.size > AUTOMATION_SESSION_MAX_ENTRIES ||
      retainedBytes > AUTOMATION_SESSION_MAX_RETAINED_BYTES
    ) {
      const oldestIndex = retainedEntries.keys().next().value;
      if (oldestIndex === undefined) break;
      const oldestEntry = retainedEntries.get(oldestIndex);
      if (oldestEntry) retainedBytes -= oldestEntry.bytes;
      retainedEntries.delete(oldestIndex);
    }
  };

  const rememberToolCall = (id: string, toolCall: PendingToolCall): void => {
    if (!id) return;
    pendingToolCalls.delete(id);
    pendingToolCalls.set(id, toolCall);
    while (pendingToolCalls.size > AUTOMATION_SESSION_MAX_PENDING_TOOL_CALLS) {
      const oldestId = pendingToolCalls.keys().next().value;
      if (oldestId === undefined) break;
      pendingToolCalls.delete(oldestId);
    }
  };

  try {
    await readBoundedLines(sessionFile, {
      maxLineBytes: AUTOMATION_SESSION_MAX_LINE_BYTES,
      onLine: (line) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return;
        }
        if (
          untilMs !== undefined &&
          typeof event.timestamp === "string" &&
          Date.parse(event.timestamp) > untilMs
        ) {
          return;
        }
        if (event.type === "message") {
          const message = event.message as { role?: string; content?: unknown } | null;
          if (!message) return;
          const role = message.role;
          const contentParts = Array.isArray(message.content) ? message.content : [];
          if (role === "user") {
            for (const part of contentParts) {
              const block = part as {
                type?: string;
                text?: unknown;
                tool_use_id?: unknown;
                content?: unknown;
              };
              if (block.type === "text" && typeof block.text === "string") {
                appendEntry({ type: "user", text: block.text });
              } else if (block.type === "tool_result") {
                const id = String(block.tool_use_id ?? "");
                const toolCall = pendingToolCalls.get(id);
                appendEntry({
                  type: "tool",
                  name: toolCall?.name ?? "tool",
                  ...(toolCall?.input !== undefined ? { input: toolCall.input } : {}),
                  text: capSessionToolResult(extractToolResultText(block)),
                });
                pendingToolCalls.delete(id);
              }
            }
          } else if (role === "toolResult") {
            const toolResultMessage = event.message as {
              toolCallId?: unknown;
              toolName?: unknown;
              content?: unknown;
            } | null;
            const id = String(toolResultMessage?.toolCallId ?? "");
            const toolCall = pendingToolCalls.get(id);
            const name =
              (typeof toolResultMessage?.toolName === "string" && toolResultMessage.toolName) ||
              toolCall?.name ||
              "tool";
            appendEntry({
              type: "tool",
              name,
              ...(toolCall?.input !== undefined ? { input: toolCall.input } : {}),
              text: capSessionToolResult(extractToolResultText(toolResultMessage ?? {})),
            });
            pendingToolCalls.delete(id);
          } else if (role === "assistant") {
            let text = "";
            let thinking = "";
            for (const part of contentParts) {
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
              else if (block.type === "thinking" && typeof block.thinking === "string") {
                thinking += block.thinking;
              } else if (block.type === "tool_use" || block.type === "toolCall") {
                const callId = String(block.id ?? "");
                const callName = String(block.name ?? "tool");
                const formatted = truncateToolInput(
                  formatToolInput(block.arguments ?? block.input),
                );
                rememberToolCall(
                  callId,
                  formatted ? { name: callName, input: formatted } : { name: callName },
                );
              }
            }
            if (text.length > 0 || thinking.length > 0) {
              appendEntry(
                thinking.length > 0
                  ? { type: "assistant", text, thinking }
                  : { type: "assistant", text },
              );
            }
          }
        } else if (event.type === "compaction") {
          const summary = String(event.summary ?? "");
          const tokensBefore =
            typeof event.tokensBefore === "number" ? event.tokensBefore : undefined;
          appendEntry(
            tokensBefore !== undefined
              ? { type: "compaction", summary, tokensBefore }
              : { type: "compaction", summary },
          );
        }
      },
    });
  } catch {
    return [];
  }

  return [...retainedEntries.values()].map(({ entry }) => entry);
};
