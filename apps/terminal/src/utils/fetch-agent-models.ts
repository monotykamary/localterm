import type { AgentModelInfo } from "@monotykamary/localterm-server/protocol";
import { useEffect, useSyncExternalStore } from "react";

// SWR (stale-while-revalidate) store for the agent model list. The first call
// fetches from GET /api/agent-models (the server caches pi's
// get_available_models result); later calls return the cached list
// immediately and revalidate in the background, so the selector never shows
// stale models for long but also never blocks on a slow spawn.

const EMPTY: AgentModelInfo[] = [];
let cache: { models: AgentModelInfo[] } | null = null;
let revalidating: Promise<void> | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): AgentModelInfo[] => cache?.models ?? EMPTY;

const revalidate = async (): Promise<void> => {
  if (revalidating) return revalidating;
  revalidating = (async () => {
    try {
      const response = await fetch(new URL("/api/agent-models", window.location.href));
      const body = response.ok ? ((await response.json()) as { models?: AgentModelInfo[] }) : null;
      cache = { models: body?.models ?? [] };
      notify();
    } catch {
      // keep the stale cache (or empty) on failure
    } finally {
      revalidating = null;
    }
  })();
  return revalidating;
};

// SWR hook: returns the cached models immediately (stale) and revalidates on
// mount so the list refreshes each time the form opens. `loading` is true
// only before the first fetch resolves.
export const useAgentModels = (): { models: AgentModelInfo[]; loading: boolean } => {
  const models = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    void revalidate();
  }, []);
  return { models, loading: cache === null };
};

// Test-only: reset the SWR cache + in-flight revalidation between cases.
export const __resetAgentModelsCache = (): void => {
  cache = null;
  revalidating = null;
};
