import { EventEmitter } from "node:events";
import path from "node:path";
import type { Automation, AutomationSessionEvent } from "./types.js";

interface SessionEventManagerEvents {
  due: [automation: Automation];
}

export type SessionEventName =
  | "git-dirty"
  | "git-head-change"
  | "git-branch-change"
  | "git-tag-change"
  | "git-remote-change"
  | "git-stash-change"
  | "git-commit"
  | "git-checkout"
  | "git-reset"
  | "git-merge"
  | "git-rebase"
  | "git-cherry-pick"
  | "git-fetch"
  | "git-stash"
  | "git-tag"
  | "notification"
  | "cwd"
  | "foreground"
  | "exit";

interface SessionEventEntry {
  debounceTimer: NodeJS.Timeout | null;
  signature: string;
  postRunGraceTimer: NodeJS.Timeout | null;
  postRunGraceActive: boolean;
}

const signatureOf = (automation: Automation): string =>
  automation.trigger.kind === "event"
    ? `${automation.trigger.events.join(",")}:${automation.cwd}`
    : "";

export class SessionEventManager extends EventEmitter<SessionEventManagerEvents> {
  private readonly entries = new Map<string, SessionEventEntry>();
  private disposed = false;

  constructor(
    private readonly options: {
      debounceMs: number;
      postRunGraceMs: number;
      isRunInFlight: (automationId: string) => boolean;
      getAutomation: (automationId: string) => Automation | null;
    },
  ) {
    super();
  }

  sync(automations: Automation[]): void {
    if (this.disposed) return;
    const desired = new Map<string, Automation>();
    for (const automation of automations) {
      if (!automation.enabled) continue;
      if (automation.lifecycle !== "active") continue;
      if (automation.trigger.kind !== "event") continue;
      desired.set(automation.id, automation);
    }
    for (const [id, entry] of this.entries) {
      const automation = desired.get(id);
      if (!automation || signatureOf(automation) !== entry.signature) this.stopEntry(id);
    }
    for (const [id, automation] of desired) {
      if (!this.entries.has(id)) this.startEntry(automation);
    }
  }

  onSessionEvent(eventName: SessionEventName, sessionCwd: string): void {
    if (this.disposed) return;
    for (const [id, entry] of this.entries) {
      if (entry.postRunGraceActive) continue;
      const automation = this.options.getAutomation(id);
      if (!automation || automation.trigger.kind !== "event") continue;
      if (!automation.trigger.events.includes(eventName as AutomationSessionEvent)) continue;
      if (!isCwdMatch(automation.cwd, sessionCwd)) continue;
      if (entry.debounceTimer !== null) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        this.fire(id);
      }, this.options.debounceMs);
      entry.debounceTimer.unref?.();
    }
  }

  notifyRunFinished(automationId: string): void {
    if (this.disposed) return;
    const entry = this.entries.get(automationId);
    if (!entry) return;
    if (entry.postRunGraceTimer !== null) clearTimeout(entry.postRunGraceTimer);
    entry.postRunGraceActive = true;
    entry.postRunGraceTimer = setTimeout(() => {
      entry.postRunGraceActive = false;
      entry.postRunGraceTimer = null;
    }, this.options.postRunGraceMs);
    entry.postRunGraceTimer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.entries.keys()]) this.stopEntry(id);
    this.removeAllListeners();
  }

  private startEntry(automation: Automation): void {
    if (automation.trigger.kind !== "event") return;
    const entry: SessionEventEntry = {
      debounceTimer: null,
      signature: signatureOf(automation),
      postRunGraceTimer: null,
      postRunGraceActive: false,
    };
    this.entries.set(automation.id, entry);
  }

  private fire(automationId: string): void {
    if (this.disposed) return;
    if (!this.entries.has(automationId)) return;
    if (this.options.isRunInFlight(automationId)) return;
    const automation = this.options.getAutomation(automationId);
    if (!automation || !automation.enabled || automation.lifecycle !== "active") return;
    if (automation.trigger.kind !== "event") return;
    this.emit("due", automation);
  }

  private stopEntry(automationId: string): void {
    const entry = this.entries.get(automationId);
    if (!entry) return;
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    if (entry.postRunGraceTimer !== null) {
      clearTimeout(entry.postRunGraceTimer);
      entry.postRunGraceTimer = null;
    }
    entry.postRunGraceActive = false;
    this.entries.delete(automationId);
  }
}

const isCwdMatch = (automationCwd: string, sessionCwd: string): boolean => {
  const resolvedAutomation = path.resolve(automationCwd);
  const resolvedSession = path.resolve(sessionCwd);
  return (
    resolvedSession === resolvedAutomation ||
    resolvedSession.startsWith(resolvedAutomation + path.sep)
  );
};
