import { create } from "zustand";
import { createSession, deleteSession, fetchSessions } from "./api";
import type { CreateSessionInput, SessionMetadata } from "./types";

interface SessionsState {
  sessions: SessionMetadata[];
  activeId: string | null;
  isLoading: boolean;
  hasLoaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input?: CreateSessionInput) => Promise<SessionMetadata>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  patchTitle: (id: string, title: string) => void;
  markExited: (id: string, code: number | null) => void;
  removeLocal: (id: string) => void;
}

const sortByCreatedAt = (sessions: SessionMetadata[]): SessionMetadata[] =>
  sessions.toSorted((leftSession, rightSession) => leftSession.createdAt - rightSession.createdAt);

const readUrlTab = (): string | null => {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("tab");
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  isLoading: false,
  hasLoaded: false,
  error: null,

  refresh: async () => {
    set({ isLoading: true, error: null });
    try {
      const fetched = sortByCreatedAt(await fetchSessions());
      const previousActive = get().activeId;
      const previousStillExists =
        previousActive && fetched.some((session) => session.id === previousActive);
      const urlTab = readUrlTab();
      const urlTabExists = urlTab && fetched.some((session) => session.id === urlTab);
      let nextActive: string | null;
      if (previousStillExists) nextActive = previousActive;
      else if (urlTabExists) nextActive = urlTab;
      else nextActive = fetched[0]?.id ?? null;
      set({ sessions: fetched, activeId: nextActive, isLoading: false, hasLoaded: true });
    } catch (error) {
      set({ error: errorMessage(error), isLoading: false, hasLoaded: true });
    }
  },

  create: async (input) => {
    const created = await createSession(input);
    set((state) => ({
      sessions: sortByCreatedAt([...state.sessions, created]),
      activeId: created.id,
    }));
    return created;
  },

  remove: async (id) => {
    await deleteSession(id);
    get().removeLocal(id);
  },

  removeLocal: (id) => {
    set((state) => {
      const remaining = state.sessions.filter((session) => session.id !== id);
      const wasActive = state.activeId === id;
      const nextActive = wasActive ? (remaining[0]?.id ?? null) : state.activeId;
      return { sessions: remaining, activeId: nextActive };
    });
  },

  setActive: (id) => {
    set({ activeId: id });
  },

  patchTitle: (id, title) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session,
      ),
    }));
  },

  markExited: (id, code) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, exited: true, exitCode: code } : session,
      ),
    }));
  },
}));
