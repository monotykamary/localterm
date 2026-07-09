import type { AgentEndEvent } from "@earendil-works/pi-coding-agent";
import { AGENT_NOTIFY_EXCERPT_MAX_CHARS } from "../constants.js";
import { collapseWhitespace } from "./collapse-whitespace.js";

const ELLIPSIS = "…";

const formatElapsedSeconds = (elapsedMs: number): string => {
  const totalSeconds = elapsedMs / 1000;
  if (totalSeconds < 60) {
    // Floor to tenths instead of toFixed-rounding so a turn just under a
    // minute never displays as "60.0s".
    const tenths = Math.floor(totalSeconds * 10) / 10;
    return `${tenths.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
};

const truncateWithEllipsis = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars - ELLIPSIS.length)}${ELLIPSIS}`;

// Pull a preview of the agent's final answer out of an agent_end's messages:
// the last assistant message that produced visible text, whitespace-collapsed
// and capped to AGENT_NOTIFY_EXCERPT_MAX_CHARS with an ellipsis. An assistant
// message is a stream of (TextContent | ThinkingContent | ToolCall) blocks;
// only TextContent is prose the user would recognize as the response, so
// thinking (internal reasoning) and tool calls are skipped. Scans backward
// from the newest message so a turn that ended on a bare tool call (no
// trailing prose) still surfaces the most recent text the agent actually said.
// Returns undefined when no assistant message carried text — e.g. the turn
// was aborted mid-tool-use — so the caller can fall back to identity + elapsed
// alone. Pure: unit-testable without a session.
export const extractAssistantExcerpt = (
  messages: AgentEndEvent["messages"],
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const messageText = message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ");
    const collapsed = collapseWhitespace(messageText);
    if (collapsed) return truncateWithEllipsis(collapsed, AGENT_NOTIFY_EXCERPT_MAX_CHARS);
  }
  return undefined;
};

// Compose the OSC 9 notification body for a finished agent turn: identity +
// elapsed time. The notification's arrival already signals "finished", so the
// text carries who (the pi session name when set, so multiple sessions are
// distinguishable), what (a truncated excerpt of the final answer when the
// turn produced one), and how long. The excerpt follows the session name,
// separated by an em dash, so a short label always precedes the prose. With
// neither, the colon is dropped to avoid a dangling "pi finished: (1.2s)".
// Pure: unit-testable without a session.
export const formatAgentEndBody = (
  elapsedMs: number,
  sessionName?: string,
  excerpt?: string,
): string => {
  const elapsed = formatElapsedSeconds(elapsedMs);
  const identity = [sessionName, excerpt]
    .filter((part): part is string => Boolean(part))
    .join(" — ");
  return identity ? `pi finished: ${identity} (${elapsed})` : `pi finished (${elapsed})`;
};
