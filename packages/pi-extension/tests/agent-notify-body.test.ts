import type { AgentEndEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vite-plus/test";
import { AGENT_NOTIFY_EXCERPT_MAX_CHARS } from "../src/constants.js";
import { extractAssistantExcerpt, formatAgentEndBody } from "../src/utils/agent-notify-body.js";

// AssistantMessage carries api/provider/model/usage/stopReason/timestamp
// fields from the transitive @earendil-works/pi-ai package, which pi-extension
// can't import directly. The fixtures below fill those with literal placeholder
// values and annotate against the importable AgentEndEvent["messages"][number]
// so TypeScript still type-checks every field without a cast. The content
// block union mirrors TextContent | ThinkingContent | ToolCall structurally.
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

type AgentEndMessage = AgentEndEvent["messages"][number];

const assistant = (content: ContentBlock[]): AgentEndMessage => ({
  role: "assistant",
  content,
  api: "test",
  provider: "test",
  model: "test",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 0,
});

const user = (text: string): AgentEndMessage => ({ role: "user", content: text, timestamp: 0 });

const toolResult = (): AgentEndMessage => ({
  role: "toolResult",
  toolCallId: "call",
  toolName: "bash",
  content: [],
  isError: false,
  timestamp: 0,
});

describe("formatAgentEndBody", () => {
  it("formats sub-minute durations as seconds with one decimal", () => {
    expect(formatAgentEndBody(12_500)).toBe("pi finished (12.5s)");
  });

  it("does not round a just-under-a-minute turn up to 60.0s", () => {
    expect(formatAgentEndBody(59_999)).toBe("pi finished (59.9s)");
  });

  it("formats minute-plus durations as minutes and seconds", () => {
    expect(formatAgentEndBody(60_000)).toBe("pi finished (1m 0s)");
    expect(formatAgentEndBody(153_000)).toBe("pi finished (2m 33s)");
  });

  it("includes the session name when provided", () => {
    expect(formatAgentEndBody(12_500, "refactor auth")).toBe("pi finished: refactor auth (12.5s)");
  });

  it("omits the session name when undefined", () => {
    expect(formatAgentEndBody(12_500, undefined)).toBe("pi finished (12.5s)");
  });

  it("appends the excerpt after the session name, separated by an em dash", () => {
    expect(formatAgentEndBody(12_500, "refactor auth", "Fixed the bug.")).toBe(
      "pi finished: refactor auth — Fixed the bug. (12.5s)",
    );
  });

  it("places the excerpt directly after the colon when there is no session name", () => {
    expect(formatAgentEndBody(12_500, undefined, "Fixed the bug.")).toBe(
      "pi finished: Fixed the bug. (12.5s)",
    );
  });

  it("drops the colon when neither session name nor excerpt is present", () => {
    expect(formatAgentEndBody(12_500, undefined, undefined)).toBe("pi finished (12.5s)");
  });
});

describe("extractAssistantExcerpt", () => {
  it("returns the last assistant message's text", () => {
    const messages: AgentEndEvent["messages"] = [
      user("please fix it"),
      assistant([{ type: "text", text: "Fixed the auth bug by adding a null check." }]),
    ];
    expect(extractAssistantExcerpt(messages)).toBe("Fixed the auth bug by adding a null check.");
  });

  it("keeps only text blocks, skipping thinking and tool calls", () => {
    const messages: AgentEndEvent["messages"] = [
      assistant([
        { type: "thinking", thinking: "planning the fix" },
        { type: "toolCall", id: "call", name: "edit", arguments: { path: "auth.ts" } },
        { type: "text", text: "Done." },
      ]),
    ];
    expect(extractAssistantExcerpt(messages)).toBe("Done.");
  });

  it("joins multiple text blocks with a single space and collapses whitespace", () => {
    const messages: AgentEndEvent["messages"] = [
      assistant([
        { type: "text", text: "First paragraph.\n\n\t  Second   paragraph." },
        { type: "text", text: "Third." },
      ]),
    ];
    expect(extractAssistantExcerpt(messages)).toBe("First paragraph. Second paragraph. Third.");
  });

  it("truncates text over the cap, preserving the cap length with an ellipsis", () => {
    const overlong = "a".repeat(AGENT_NOTIFY_EXCERPT_MAX_CHARS + 40);
    const messages: AgentEndEvent["messages"] = [assistant([{ type: "text", text: overlong }])];
    expect(extractAssistantExcerpt(messages)).toBe(
      "a".repeat(AGENT_NOTIFY_EXCERPT_MAX_CHARS - 1) + "…",
    );
  });

  it("does not add an ellipsis when the text fits the cap exactly", () => {
    const exact = "a".repeat(AGENT_NOTIFY_EXCERPT_MAX_CHARS);
    const messages: AgentEndEvent["messages"] = [assistant([{ type: "text", text: exact }])];
    expect(extractAssistantExcerpt(messages)).toBe(exact);
  });

  it("falls back to the previous assistant message when the last one has no text", () => {
    const messages: AgentEndEvent["messages"] = [
      assistant([{ type: "text", text: "Here is the plan." }]),
      toolResult(),
      assistant([{ type: "toolCall", id: "call2", name: "bash", arguments: { command: "ls" } }]),
    ];
    expect(extractAssistantExcerpt(messages)).toBe("Here is the plan.");
  });

  it("returns undefined when no assistant message carries text", () => {
    const messages: AgentEndEvent["messages"] = [
      user("run the tests"),
      assistant([
        { type: "toolCall", id: "call", name: "bash", arguments: { command: "pnpm test" } },
      ]),
      toolResult(),
    ];
    expect(extractAssistantExcerpt(messages)).toBeUndefined();
  });

  it("returns undefined when there are no assistant messages", () => {
    const messages: AgentEndEvent["messages"] = [user("hello"), toolResult()];
    expect(extractAssistantExcerpt(messages)).toBeUndefined();
  });

  it("returns undefined for an empty message list", () => {
    expect(extractAssistantExcerpt([])).toBeUndefined();
  });
});
