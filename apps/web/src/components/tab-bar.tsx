import { Plus, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { TAB_MAX_WIDTH_PX } from "@/lib/constants";
import { useSessions } from "@/lib/use-sessions";
import { cn } from "@/lib/utils";

interface TabBarProps {
  onNew: () => void;
}

interface TabSummary {
  id: string;
  title: string;
  exited: boolean;
}

const summarizeTabs = (
  sessions: ReturnType<typeof useSessions.getState>["sessions"],
): TabSummary[] =>
  sessions.map((session) => ({ id: session.id, title: session.title, exited: session.exited }));

export const TabBar = ({ onNew }: TabBarProps) => {
  const tabs = useSessions(useShallow((state) => summarizeTabs(state.sessions)));
  const activeId = useSessions((state) => state.activeId);
  const setActive = useSessions((state) => state.setActive);
  const remove = useSessions((state) => state.remove);

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
      <div
        role="tablist"
        aria-label="terminal sessions"
        className="flex flex-1 items-center gap-0.5 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const label = tab.title || "shell";
          return (
            <div
              key={tab.id}
              className={cn(
                "group relative flex h-7 items-center rounded-md text-xs transition-colors",
                isActive
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                tab.exited && "italic opacity-60",
              )}
              style={{ maxWidth: TAB_MAX_WIDTH_PX }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  void remove(tab.id);
                }
              }}
            >
              <button
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`terminal-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActive(tab.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span
                  className="size-1.5 shrink-0 rounded-full bg-current opacity-60"
                  aria-hidden="true"
                />
                <span className="truncate">{label}</span>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void remove(tab.id);
                }}
                aria-label={`close ${label}`}
                className="mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-background/50 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        className="shrink-0"
        onClick={onNew}
        aria-label="new tab"
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
};
