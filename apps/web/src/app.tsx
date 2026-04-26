import { useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { TabBar } from "@/components/tab-bar";
import { TerminalView } from "@/components/terminal-view";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTabKeybindings } from "@/lib/use-tab-keybindings";
import { useSessions } from "@/lib/use-sessions";

const writeUrlTab = (id: string | null) => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const current = url.searchParams.get("tab");
  if (id === current) return;
  if (id) url.searchParams.set("tab", id);
  else url.searchParams.delete("tab");
  window.history.replaceState({}, "", url);
};

export const App = () => {
  const tabIds = useSessions(useShallow((state) => state.sessions.map((session) => session.id)));
  const activeId = useSessions((state) => state.activeId);
  const isLoading = useSessions((state) => state.isLoading);
  const hasLoaded = useSessions((state) => state.hasLoaded);
  const error = useSessions((state) => state.error);
  const refresh = useSessions((state) => state.refresh);
  const create = useSessions((state) => state.create);
  const remove = useSessions((state) => state.remove);
  const setActive = useSessions((state) => state.setActive);

  useEffect(() => {
    void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  useEffect(() => {
    if (!hasLoaded) return;
    writeUrlTab(activeId);
  }, [hasLoaded, activeId]);

  useEffect(() => {
    const onPopState = () => {
      const url = new URL(window.location.href);
      const desired = url.searchParams.get("tab");
      if (!desired) return;
      const exists = useSessions.getState().sessions.some((session) => session.id === desired);
      if (exists) setActive(desired);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setActive]);

  const ensureCreatingRef = useRef(false);
  useEffect(() => {
    if (!hasLoaded) return;
    if (error) return;
    if (tabIds.length > 0) {
      ensureCreatingRef.current = false;
      return;
    }
    if (ensureCreatingRef.current) return;
    ensureCreatingRef.current = true;
    create({}).catch((creationError) => {
      console.error(creationError);
      ensureCreatingRef.current = false;
    });
  }, [hasLoaded, error, tabIds.length, create]);

  const handleNewTab = useCallback(async () => {
    try {
      await create(activeId ? { inheritCwdFromSessionId: activeId } : {});
    } catch (creationError) {
      console.error(creationError);
    }
  }, [activeId, create]);

  const closeActive = useCallback(() => {
    if (!activeId) return;
    if (tabIds.length <= 1) return;
    void remove(activeId);
  }, [activeId, tabIds.length, remove]);

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      if (tabIds.length === 0) return;
      const currentIndex = tabIds.findIndex((tabId) => tabId === activeId);
      const nextIndex = (currentIndex + direction + tabIds.length) % tabIds.length;
      const nextTabId = tabIds[nextIndex];
      if (nextTabId) setActive(nextTabId);
    },
    [tabIds, activeId, setActive],
  );

  const jumpTo = useCallback(
    (index: number) => {
      const target = tabIds[index];
      if (target) setActive(target);
    },
    [tabIds, setActive],
  );

  useTabKeybindings(
    useMemo(
      () => ({
        onNewTab: () => void handleNewTab(),
        onCloseTab: closeActive,
        onNextTab: () => cycleTab(1),
        onPrevTab: () => cycleTab(-1),
        onJumpTo: jumpTo,
      }),
      [handleNewTab, closeActive, cycleTab, jumpTo],
    ),
  );

  if (!hasLoaded && isLoading) {
    return (
      <div className="grid h-dvh place-items-center bg-background text-sm text-muted-foreground">
        loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid h-dvh place-items-center bg-background text-sm text-destructive-foreground">
        <div className="flex flex-col items-center gap-2 text-center">
          <p>cannot reach localterm server</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button size="sm" onClick={() => void refresh()}>
            retry
          </Button>
        </div>
      </div>
    );
  }

  const activeTabValue = activeId ?? "";

  return (
    <TooltipProvider delayDuration={400}>
      <Tabs
        value={activeTabValue}
        onValueChange={setActive}
        className="flex h-dvh flex-col gap-0 bg-[#101010] text-foreground"
      >
        <TabBar onNew={() => void handleNewTab()} />
        <div className="relative flex-1 overflow-hidden bg-[#101010]">
          {tabIds.map((tabId) => (
            <TabsContent
              key={tabId}
              value={tabId}
              forceMount
              className="absolute inset-0 m-0 outline-none data-[state=inactive]:hidden"
            >
              <TerminalView sessionId={tabId} isActive={tabId === activeId} />
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </TooltipProvider>
  );
};
