import fs from "node:fs";
import path from "node:path";
import { daemonConfigFileSchema } from "@monotykamary/localterm-server/protocol";
import { getStateDirectory } from "../paths.js";

// Reads the configured CDP port from ~/.localterm/config.json so the CLI's
// pre-daemon probes (start banner, install checklist) target the same endpoint
// the daemon will attach to. Tolerant of a missing/corrupt file (returns null =
// auto-detect) — the daemon owns the canonical read via DaemonConfigStore.
export const readConfiguredCdpPort = (): number | null => {
  const filePath = path.join(getStateDirectory(), "config.json");
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = daemonConfigFileSchema.safeParse(json);
  return parsed.success ? parsed.data.cdpPort : null;
};
