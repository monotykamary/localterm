import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { HIBERNATE_FILE_VERSION } from "./constants.js";

export interface HibernateTab {
  sessionId: string;
  cwd: string;
  shell: string;
  scrollback: string;
}

export interface HibernateEntry {
  owner: string | null;
  windowId: string;
  tabs: HibernateTab[];
}

const hibernateTabSchema = z
  .object({
    sessionId: z.string(),
    cwd: z.string(),
    shell: z.string(),
    scrollback: z.string(),
  })
  .strict();
const hibernateEntrySchema = z
  .object({
    owner: z.string().nullable(),
    windowId: z.string(),
    tabs: z.array(hibernateTabSchema),
  })
  .strict();
const hibernateFileSchema = z
  .object({
    version: z.literal(HIBERNATE_FILE_VERSION),
    entries: z.array(hibernateEntrySchema),
  })
  .strict();

// One compact file written during graceful daemon shutdown. Scrollback is
// rendered text with generated SGR styling; raw PTY control bytes are never stored.
export class HibernateStore {
  constructor(private readonly filePath: string) {}

  read(): HibernateEntry[] {
    try {
      const parsed = hibernateFileSchema.safeParse(
        JSON.parse(fs.readFileSync(this.filePath, "utf8")),
      );
      return parsed.success ? parsed.data.entries : [];
    } catch {
      return [];
    }
  }

  write(entries: readonly HibernateEntry[]): void {
    const file = {
      version: HIBERNATE_FILE_VERSION,
      entries,
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmpPath, this.filePath);
  }
}
