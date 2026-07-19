import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  AGENT_NOTIFY_MIN_ELAPSED_MS,
  PI_RETRY_CANCELLED_EVENT,
  PI_RETRY_COMPLETED_EVENT,
  PI_RETRY_STARTED_EVENT,
} from "../src/constants.js";
import { extractAssistantExcerpt, formatAgentEndBody } from "../src/utils/agent-notify-body.js";
import { retryEventId } from "../src/utils/retry-event-id.js";
import { buildOsc9Sequence } from "../src/utils/osc-sequence.js";

export const registerAgentNotify = (pi: ExtensionAPI): void => {
  let activeRetryId: number | undefined;
  let latestMessages: AgentEndEvent["messages"] = [];
  let settledContext: ExtensionContext | undefined;
  let turnStartedAt: number | undefined;
  let hasCurrentRunSettled = false;

  const resetNotificationState = (): void => {
    latestMessages = [];
    settledContext = undefined;
    turnStartedAt = undefined;
    hasCurrentRunSettled = false;
  };

  const emitNotification = (): void => {
    if (!hasCurrentRunSettled || settledContext === undefined || turnStartedAt === undefined)
      return;

    const elapsedMs = Date.now() - turnStartedAt;
    const context = settledContext;
    const messages = latestMessages;
    resetNotificationState();

    if (context.mode !== "tui" || elapsedMs < AGENT_NOTIFY_MIN_ELAPSED_MS) return;

    const body = formatAgentEndBody(
      elapsedMs,
      pi.getSessionName(),
      extractAssistantExcerpt(messages),
    );
    process.stdout.write(buildOsc9Sequence(body));
  };

  const unsubscribeRetryStarted = pi.events.on(PI_RETRY_STARTED_EVENT, (event) => {
    activeRetryId = retryEventId(event);
  });
  const unsubscribeRetryCompleted = pi.events.on(PI_RETRY_COMPLETED_EVENT, (event) => {
    if (retryEventId(event) !== activeRetryId) return;
    activeRetryId = undefined;
    emitNotification();
  });
  const unsubscribeRetryCancelled = pi.events.on(PI_RETRY_CANCELLED_EVENT, (event) => {
    if (retryEventId(event) !== activeRetryId) return;
    activeRetryId = undefined;
    resetNotificationState();
  });

  pi.on("agent_start", () => {
    turnStartedAt ??= Date.now();
    hasCurrentRunSettled = false;
    settledContext = undefined;
  });

  pi.on("agent_end", (event) => {
    latestMessages = event.messages;
  });

  pi.on("agent_settled", (_event, context) => {
    hasCurrentRunSettled = true;
    settledContext = context;
    if (activeRetryId === undefined) emitNotification();
  });

  pi.on("session_shutdown", () => {
    unsubscribeRetryStarted();
    unsubscribeRetryCompleted();
    unsubscribeRetryCancelled();
    resetNotificationState();
  });
};
