import { EventEmitter } from "node:events";
import type { Automation } from "./types.js";

interface WebhookTriggerManagerEvents {
  due: [automation: Automation];
}

interface WebhookTriggerManagerOptions {
  // Quiet period after a POST before firing. Coalesces duplicate delivery (a CI
  // retry, an LB double-fire) into a single run. Trailing-edge: the timer
  // resets on every POST and fires once the burst settles.
  debounceMs: number;
  // True while a run for this automation is still launching/running. Drops a
  // POST that arrives while a prior run is in flight (at most one run per
  // automation at a time) — same overlap guard as the watch/event managers.
  isRunInFlight: (automationId: string) => boolean;
  // The latest stored automation, re-read at fire time so an edit made during
  // the debounce window (disabled, limit reached, switched to a schedule) is
  // honored instead of the snapshot captured when the POST arrived.
  getAutomation: (automationId: string) => Automation | null;
}

// Event-driven webhook triggers for automations. A POST to /api/webhooks/:id
// (resolved to an automation by the route) arms a trailing debounce per
// automation; when it fires, the manager re-reads live state and emits "due",
// which the server wires to tryLaunch(automation, "webhook"). Stateless vs the
// watch/event managers — there is nothing to arm (no watcher, no listener), so
// the store is the registry and the route does the id→automation lookup before
// calling trigger(). No post-run grace: a webhook is an external signal, not a
// side effect of the command, so the in-flight guard alone prevents overlap.
export class WebhookTriggerManager extends EventEmitter<WebhookTriggerManagerEvents> {
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private disposed = false;

  constructor(private readonly options: WebhookTriggerManagerOptions) {
    super();
  }

  trigger(automation: Automation): void {
    if (this.disposed) return;
    // Drop a POST that arrives while a run is still in flight rather than
    // queueing it — the next POST after it settles re-arms.
    if (this.options.isRunInFlight(automation.id)) return;
    const existing = this.debounceTimers.get(automation.id);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(automation.id);
      this.fire(automation.id);
    }, this.options.debounceMs);
    timer.unref?.();
    this.debounceTimers.set(automation.id, timer);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.removeAllListeners();
  }

  private fire(automationId: string): void {
    if (this.disposed) return;
    if (this.options.isRunInFlight(automationId)) return;
    const automation = this.options.getAutomation(automationId);
    if (!automation || !automation.enabled || automation.lifecycle !== "active") return;
    if (automation.trigger.kind !== "webhook") return;
    this.emit("due", automation);
  }
}
