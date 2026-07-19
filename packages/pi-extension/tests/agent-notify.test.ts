import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  PI_RETRY_CANCELLED_EVENT,
  PI_RETRY_COMPLETED_EVENT,
  PI_RETRY_STARTED_EVENT,
} from "../src/constants.js";
import { registerAgentNotify } from "../extensions/agent-notify.js";

interface StoredExtensionHandler {
  (event: unknown, context: ExtensionContext): unknown;
}

interface AgentNotifyFixture {
  emitAgentEvent: (name: string, event?: unknown) => void;
  emitRetryEvent: (name: string, retryId: number) => void;
}

const createFixture = (): AgentNotifyFixture => {
  const agentHandlers = new Map<string, StoredExtensionHandler[]>();
  const retryHandlers = new Map<string, Array<(event: unknown) => void>>();
  const context = { mode: "tui" } as ExtensionContext;
  const api = {
    events: {
      emit(name: string, event: unknown) {
        for (const handler of retryHandlers.get(name) ?? []) handler(event);
      },
      on(name: string, handler: (event: unknown) => void) {
        const handlers = retryHandlers.get(name) ?? [];
        handlers.push(handler);
        retryHandlers.set(name, handlers);
        return () =>
          retryHandlers.set(
            name,
            handlers.filter((candidate) => candidate !== handler),
          );
      },
    },
    getSessionName: () => "notification test",
    on(name: string, handler: StoredExtensionHandler) {
      const handlers = agentHandlers.get(name) ?? [];
      handlers.push(handler);
      agentHandlers.set(name, handlers);
    },
  } as unknown as ExtensionAPI;

  registerAgentNotify(api);

  return {
    emitAgentEvent: (name, event = {}) => {
      for (const handler of agentHandlers.get(name) ?? []) handler(event, context);
    },
    emitRetryEvent: (name, retryId) => api.events.emit(name, { retryId }),
  };
};

describe("registerAgentNotify", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("emits only after agent_settled", () => {
    const fixture = createFixture();
    fixture.emitAgentEvent("agent_start");
    vi.setSystemTime(31_000);
    fixture.emitAgentEvent("agent_end", { messages: [] });

    expect(process.stdout.write).not.toHaveBeenCalled();

    fixture.emitAgentEvent("agent_settled");
    expect(process.stdout.write).toHaveBeenCalledTimes(1);
  });

  it("waits for pi-retry to complete after its final run settles", () => {
    const fixture = createFixture();
    fixture.emitAgentEvent("agent_start");
    fixture.emitAgentEvent("agent_end", { messages: [] });
    fixture.emitRetryEvent(PI_RETRY_STARTED_EVENT, 1);
    fixture.emitAgentEvent("agent_settled");

    fixture.emitAgentEvent("agent_start");
    vi.setSystemTime(31_000);
    fixture.emitAgentEvent("agent_end", { messages: [] });
    fixture.emitAgentEvent("agent_settled");

    expect(process.stdout.write).not.toHaveBeenCalled();

    fixture.emitRetryEvent(PI_RETRY_COMPLETED_EVENT, 1);
    expect(process.stdout.write).toHaveBeenCalledTimes(1);
  });

  it("waits for final agent_settled when retry completion arrives first", () => {
    const fixture = createFixture();
    fixture.emitAgentEvent("agent_start");
    fixture.emitAgentEvent("agent_end", { messages: [] });
    fixture.emitRetryEvent(PI_RETRY_STARTED_EVENT, 2);
    fixture.emitAgentEvent("agent_settled");
    fixture.emitAgentEvent("agent_start");
    vi.setSystemTime(31_000);
    fixture.emitAgentEvent("agent_end", { messages: [] });

    fixture.emitRetryEvent(PI_RETRY_COMPLETED_EVENT, 2);
    expect(process.stdout.write).not.toHaveBeenCalled();

    fixture.emitAgentEvent("agent_settled");
    expect(process.stdout.write).toHaveBeenCalledTimes(1);
  });

  it("does not emit when pi-retry is cancelled", () => {
    const fixture = createFixture();
    fixture.emitAgentEvent("agent_start");
    fixture.emitAgentEvent("agent_end", { messages: [] });
    fixture.emitRetryEvent(PI_RETRY_STARTED_EVENT, 3);
    vi.setSystemTime(31_000);
    fixture.emitAgentEvent("agent_settled");
    fixture.emitRetryEvent(PI_RETRY_CANCELLED_EVENT, 3);

    expect(process.stdout.write).not.toHaveBeenCalled();
  });
});
