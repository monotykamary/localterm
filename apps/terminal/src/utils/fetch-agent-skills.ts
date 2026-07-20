import type { AgentSkillInfo } from "@monotykamary/localterm-server/protocol";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AGENT_SKILL_CACHE_MAX_CWDS } from "@/lib/constants";

// SWR (stale-while-revalidate) store for the agent skill list, keyed by the
// automation's cwd (project skills differ per directory). The first call
// fetches from GET /api/agent-skills?cwd=… (the server caches the filesystem
// scan); later calls return the cached list immediately and revalidate in the
// background, so the slash-menu never blocks on a slow scan but also never
// stays stale.

const EMPTY: AgentSkillInfo[] = [];
const cache = new Map<string, AgentSkillInfo[]>();
const revalidating = new Map<string, Promise<void>>();
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

const revalidate = async (cwd: string): Promise<void> => {
  const existing = revalidating.get(cwd);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const params = new URLSearchParams();
      if (cwd.length > 0) params.set("cwd", cwd);
      const response = await fetch(
        new URL(`/api/agent-skills?${params.toString()}`, window.location.href),
      );
      const body = response.ok ? ((await response.json()) as { skills?: AgentSkillInfo[] }) : null;
      cache.delete(cwd);
      cache.set(cwd, body?.skills ?? []);
      while (cache.size > AGENT_SKILL_CACHE_MAX_CWDS) {
        const oldestCwd = cache.keys().next().value;
        if (oldestCwd === undefined) break;
        cache.delete(oldestCwd);
      }
      notify();
    } catch {
      // keep the stale cache (or empty) on failure
    } finally {
      revalidating.delete(cwd);
    }
  })();
  revalidating.set(cwd, promise);
  return promise;
};

// SWR hook: returns the cached skills for this cwd immediately (stale) and
// revalidates on mount / when cwd changes. `loading` is true only before the
// first fetch for this cwd resolves.
export const useAgentSkills = (cwd: string): { skills: AgentSkillInfo[]; loading: boolean } => {
  const getSnapshot = useCallback((): AgentSkillInfo[] => cache.get(cwd) ?? EMPTY, [cwd]);
  const skills = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    void revalidate(cwd);
  }, [cwd]);
  return { skills, loading: !cache.has(cwd) };
};

// Test-only: reset the SWR cache + in-flight revalidations between cases.
export const __resetAgentSkillsCache = (): void => {
  cache.clear();
  revalidating.clear();
};
