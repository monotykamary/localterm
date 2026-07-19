import type {
  AutomationRunRecord,
  AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";
import { TRIAGE_THREAD_MIN_RUNS } from "@/lib/constants";
import { triageDateBandLabel } from "@/utils/triage-date-bands";

export interface TriageRunEntry {
  automation: AutomationWithNextRun;
  run: AutomationRunRecord;
}

interface TriageInlineRow {
  kind: "inline";
  automation: AutomationWithNextRun;
  run: AutomationRunRecord;
  latestTimestamp: number;
}

interface TriageThreadRow {
  kind: "thread";
  automation: AutomationWithNextRun;
  runs: AutomationRunRecord[];
  latestTimestamp: number;
  unreadCount: number;
}

type TriageRow = TriageInlineRow | TriageThreadRow;

export interface TriageSection {
  label: string;
  rows: TriageRow[];
}

const runTimestamp = (run: AutomationRunRecord): number =>
  run.finishedAt ?? run.startedAt ?? run.scheduledFor;

const BAND_ORDER = ["Today", "Yesterday", "This week", "Earlier"] as const;

// Collapse same-automation runs into a single thread (Gmail conversation) once
// an automation has at least TRIAGE_THREAD_MIN_RUNS runs in the visible set;
// single-run automations stay inline. Rows are ordered by their newest run,
// then bucketed into date bands. The input is assumed newest-first.
export const groupTriageRuns = (entries: TriageRunEntry[], nowMs: number): TriageSection[] => {
  const buckets = new Map<
    string,
    { automation: AutomationWithNextRun; runs: AutomationRunRecord[] }
  >();
  for (const entry of entries) {
    const existing = buckets.get(entry.automation.id);
    if (existing) existing.runs.push(entry.run);
    else buckets.set(entry.automation.id, { automation: entry.automation, runs: [entry.run] });
  }

  const rows: TriageRow[] = [];
  for (const { automation, runs } of buckets.values()) {
    const latestTimestamp = runTimestamp(runs[0]);
    if (runs.length >= TRIAGE_THREAD_MIN_RUNS) {
      rows.push({
        kind: "thread",
        automation,
        runs,
        latestTimestamp,
        unreadCount: runs.filter((run) => run.unread).length,
      });
    } else {
      rows.push({ kind: "inline", automation, run: runs[0], latestTimestamp });
    }
  }

  rows.sort((a, b) => b.latestTimestamp - a.latestTimestamp);

  const sectionsByLabel = new Map<string, TriageRow[]>();
  for (const row of rows) {
    const label = triageDateBandLabel(row.latestTimestamp, nowMs);
    const existing = sectionsByLabel.get(label);
    if (existing) existing.push(row);
    else sectionsByLabel.set(label, [row]);
  }

  const sections: TriageSection[] = [];
  for (const label of BAND_ORDER) {
    const sectionRows = sectionsByLabel.get(label);
    if (sectionRows) sections.push({ label, rows: sectionRows });
  }
  return sections;
};
