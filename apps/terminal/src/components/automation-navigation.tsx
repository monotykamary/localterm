import type { AutomationWithNextRun } from "@monotykamary/localterm-server/protocol";
import { Search } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AUTOMATIONS_SORT_OPTIONS, type AutomationsSort } from "@/lib/automations-sort";
import { AUTOMATIONS_LIST_OVERSCAN_ROWS, AUTOMATIONS_LIST_ROW_HEIGHT_PX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { runnerSummary } from "@/utils/runner-form";
import { runStatusBadge } from "@/utils/run-status-badge";
import { triggerLabel } from "@/utils/schedule-builder";

interface AutomationListPopoverProps {
  automations: AutomationWithNextRun[] | null;
  selectedId: string | null;
  nowMs: number;
  onSelect: (id: string) => void;
}

export const AutomationListPopover = ({
  automations,
  selectedId,
  nowMs,
  onSelect,
}: AutomationListPopoverProps) => {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!automations) return null;
    const lower = search.toLowerCase();
    return lower
      ? automations.filter(
          (automation) =>
            automation.name.toLowerCase().includes(lower) ||
            runnerSummary(automation.runner).toLowerCase().includes(lower),
        )
      : automations;
  }, [automations, search]);

  return (
    <div className="flex max-h-72 flex-col">
      <div className="border-b border-border/40 px-2 py-1.5">
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search automations…"
          autoFocus
          className="w-full rounded-sm border border-border/50 bg-transparent py-0.5 px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring"
        />
      </div>
      <div
        className="overflow-y-auto overscroll-contain p-1"
        role="listbox"
        aria-label="automations"
      >
        {filtered === null ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {search ? "No automations match your search." : "No automations yet."}
          </p>
        ) : (
          filtered.map((automation) => {
            const isSelected = automation.id === selectedId;
            return (
              <button
                key={automation.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelect(automation.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
                  isSelected
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5",
                )}
              >
                <span
                  className={cn(
                    "min-w-0 truncate text-xs",
                    !automation.enabled && "line-through opacity-60",
                  )}
                >
                  {automation.name}
                </span>
                <span className="ml-auto shrink-0 text-[10px] tabular-nums">
                  {automation.lifecycle === "finished"
                    ? "finished"
                    : automation.trigger.kind === "watch"
                      ? automation.enabled
                        ? "watching"
                        : "paused"
                      : automation.trigger.kind === "event"
                        ? automation.enabled
                          ? "listening"
                          : "paused"
                        : automation.trigger.kind === "webhook"
                          ? automation.enabled
                            ? "on webhook"
                            : "paused"
                          : automation.nextRunAt !== null
                            ? formatRelativeTime(automation.nextRunAt, nowMs)
                            : "paused"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

interface AutomationSidebarProps {
  automations: AutomationWithNextRun[] | null;
  sortBy: AutomationsSort;
  search: string;
  selectedId: string | null;
  nowMs: number;
  onSortChange: (value: AutomationsSort) => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
}

export const AutomationSidebar = ({
  automations,
  sortBy,
  search,
  selectedId,
  nowMs,
  onSortChange,
  onSearchChange,
  onSelect,
}: AutomationSidebarProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: automations?.length ?? 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => AUTOMATIONS_LIST_ROW_HEIGHT_PX,
    overscan: AUTOMATIONS_LIST_OVERSCAN_ROWS,
    getItemKey: (index) => automations![index].id,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="relative px-1.5 pt-1.5 pb-0.5">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search…"
          className="w-full rounded-sm border border-border/50 bg-transparent py-1 pl-6 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-border"
        />
      </div>
      <div className="flex items-center gap-1 px-2 pb-1">
        {AUTOMATIONS_SORT_OPTIONS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onSortChange(value)}
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-[10px] transition-colors",
              sortBy === value
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "last-run" ? "Last run" : value === "created" ? "Created" : "Name"}
          </button>
        ))}
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="automations"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 pt-0"
      >
        {automations === null ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
        ) : automations.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {search
              ? "No automations match your search."
              : "No automations yet. Scheduled commands open a new tab when they run."}
          </p>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const automation = automations[virtualRow.index];
              const badge = automation.lastRun
                ? runStatusBadge(automation.lastRun.status, automation.lastRun.exitCode)
                : null;
              const isSelected = automation.id === selectedId;
              return (
                <button
                  key={automation.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onSelect(automation.id)}
                  data-index={virtualRow.index}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
                    isSelected
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5",
                  )}
                  style={
                    {
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    } satisfies CSSProperties
                  }
                >
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "min-w-0 truncate text-xs",
                        !automation.enabled && "line-through opacity-60",
                      )}
                    >
                      {automation.name}
                    </span>
                    {badge ? (
                      <span className={cn("shrink-0 text-[10px]", badge.className)}>
                        {badge.label}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/80">
                    <span className="min-w-0 truncate">{triggerLabel(automation.trigger)}</span>
                    <span className="shrink-0 tabular-nums">
                      {automation.lifecycle === "finished"
                        ? "finished"
                        : automation.trigger.kind === "watch"
                          ? automation.enabled
                            ? "watching"
                            : "paused"
                          : automation.trigger.kind === "event"
                            ? automation.enabled
                              ? "listening"
                              : "paused"
                            : automation.trigger.kind === "webhook"
                              ? automation.enabled
                                ? "on webhook"
                                : "paused"
                              : automation.nextRunAt !== null
                                ? formatRelativeTime(automation.nextRunAt, nowMs)
                                : "paused"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
