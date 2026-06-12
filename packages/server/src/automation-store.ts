import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUTOMATIONS_FILE_VERSION } from "./constants.js";
import { automationsFileSchema } from "./schemas.js";
import type {
  Automation,
  AutomationLastRun,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "./types.js";

export class AutomationStore {
  private automations: Automation[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  list(): Automation[] {
    return [...this.automations];
  }

  get(id: string): Automation | null {
    return this.automations.find((automation) => automation.id === id) ?? null;
  }

  size(): number {
    return this.automations.length;
  }

  create(input: CreateAutomationInput): Automation {
    const now = Date.now();
    const automation: Automation = {
      id: randomUUID(),
      name: input.name,
      schedule: input.schedule,
      cwd: input.cwd,
      command: input.command,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      lastRun: null,
    };
    this.automations.push(automation);
    this.persist();
    return automation;
  }

  update(id: string, patch: UpdateAutomationInput): Automation | null {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return null;
    const current = this.automations[index];
    const updated: Automation = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
      ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
      ...(patch.command !== undefined ? { command: patch.command } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      updatedAt: Date.now(),
    };
    this.automations[index] = updated;
    this.persist();
    return updated;
  }

  remove(id: string): boolean {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return false;
    this.automations.splice(index, 1);
    this.persist();
    return true;
  }

  recordLastRun(id: string, lastRun: AutomationLastRun): Automation | null {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return null;
    const updated: Automation = { ...this.automations[index], lastRun };
    this.automations[index] = updated;
    this.persist();
    return updated;
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    try {
      const parsed = automationsFileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        this.automations = parsed.data.automations;
        return;
      }
    } catch {
      /* malformed JSON falls through to the warning below */
    }
    console.warn(`automations file invalid; starting with an empty list (${this.filePath})`);
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = { version: AUTOMATIONS_FILE_VERSION, automations: this.automations };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
