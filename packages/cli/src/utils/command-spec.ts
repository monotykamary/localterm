import { renameSync, writeFileSync } from "node:fs";
import { createProgram } from "../program.js";
import { getCommandSpecFile } from "../paths.js";
import { ensureStateDirectory } from "../state.js";
import { serializeProgram } from "./serialize-program.js";

// Persist the current command tree so the daemon's /api/completion endpoint
// can resolve static candidates in-process (no Node startup per <Tab>). Written
// atomically (tmp + rename) on daemon start/restart and on completions install;
// the daemon re-reads it per request, so a restart picks up a freshly upgraded
// CLI's tree. The CLI's own _completion fallback serializes in-memory instead,
// so it's always live regardless of this file.
export const writeCommandSpec = (): void => {
  ensureStateDirectory();
  const file = getCommandSpecFile();
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(serializeProgram(createProgram())), "utf8");
  renameSync(tmp, file);
};
