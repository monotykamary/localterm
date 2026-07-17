import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RpcClient } from "./pi-rpc-client.js";
import { resolvePiAndPath } from "./pi-binary-resolver.js";
import type { AgentModelInfo } from "./types.js";

// Cache of the available-models list (pi's RPC get_available_models). The list
// rarely changes, so cache it for a few minutes; the first call spawns pi
// (slow, ~1-5s), later calls reuse the cache.
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedModels: { at: number; models: AgentModelInfo[] } | null = null;

const listModelsViaRpcWith = async (
  binary: string,
  pathEnv: string,
  extraFlags: string[],
): Promise<AgentModelInfo[]> => {
  const args = ["--mode", "rpc", "--no-session", ...extraFlags];
  const client = new RpcClient(binary, args, os.tmpdir(), {
    ...process.env,
    PATH: pathEnv || process.env.PATH,
  });
  client.send({ type: "get_available_models", id: "models" });
  let models: AgentModelInfo[] = [];
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const line = await client.nextLine(Math.min(1000, deadline - Date.now()));
    if (line === null) {
      if (client.closed) break;
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "response" && event.id === "models" && event.success) {
      const raw = (event.data as { models?: unknown } | null)?.models;
      if (Array.isArray(raw)) {
        models = raw
          .map((model): AgentModelInfo => {
            const entry = model as {
              id?: unknown;
              name?: unknown;
              provider?: unknown;
              contextWindow?: unknown;
              reasoning?: unknown;
            };
            return {
              id: String(entry.id ?? ""),
              name: String(entry.name ?? entry.id ?? ""),
              provider: String(entry.provider ?? ""),
              ...(typeof entry.contextWindow === "number"
                ? { contextWindow: entry.contextWindow }
                : {}),
              ...(typeof entry.reasoning === "boolean" ? { reasoning: entry.reasoning } : {}),
            };
          })
          .filter((model) => model.id.length > 0);
      }
      break;
    }
  }
  client.close();
  return models;
};

const listModelsViaRpc = async (
  shimsDir: string,
  extraFlags: string[],
): Promise<AgentModelInfo[]> => {
  const { binary: realPi, pathEnv } = resolvePiAndPath(shimsDir);
  // Prefer the localterm shim for the model list: it injects the pi-process
  // secrets (so every provider with a key registers its models) then execs the
  // real pi. The bare real pi has none of those keys, so most providers don't
  // register and the list is nearly empty.
  let binary = realPi;
  const shimPi = path.join(shimsDir, "pi");
  try {
    if (fs.statSync(shimPi).isFile()) {
      fs.accessSync(shimPi, fs.constants.X_OK);
      binary = shimPi;
    }
  } catch {
    // no shim; fall back to the real pi
  }
  if (!binary) return [];
  return listModelsViaRpcWith(binary, pathEnv, extraFlags);
};

// List models available to the pi harness. Tries with extensions on (the
// default, so custom-provider models appear); if that yields nothing (e.g. the
// provider extensions crash headless), retries with --no-extensions for the
// built-in providers. Cached for a few minutes. A `piBinaryPath` override
// (tests) bypasses the shim + cache.
export const listAgentModels = async (
  shimsDir: string,
  piBinaryPath?: string,
): Promise<AgentModelInfo[]> => {
  if (piBinaryPath) return listModelsViaRpcWith(piBinaryPath, process.env.PATH ?? "", []);
  if (cachedModels && Date.now() - cachedModels.at < MODEL_CACHE_TTL_MS) return cachedModels.models;
  let models = await listModelsViaRpc(shimsDir, []);
  if (models.length === 0) models = await listModelsViaRpc(shimsDir, ["--no-extensions"]);
  cachedModels = { at: Date.now(), models };
  return models;
};

// Test-only: reset the model-list cache so a case never sees another case's
// (or another file's) cached result.
export const __resetAgentModelCache = (): void => {
  cachedModels = null;
};
