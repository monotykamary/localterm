import { Network, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import {
  PALETTE_MODAL_MAX_HEIGHT_PX,
  PORTS_LIST_ROW_HEIGHT_PX,
  PORTS_MESSAGE_BLOCK_MIN_HEIGHT_PX,
  PORTS_MODAL_CLOSE_TRANSITION_MS,
  PORTS_POLL_INTERVAL_MS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { ListeningPort } from "@monotykamary/localterm-server/protocol";
import { fetchPorts, killPort } from "@/utils/fetch-ports";

interface PortsModalProps {
  open: boolean;
  isTouchDevice: boolean;
  onClose: () => void;
}

const KeyHint = ({ keys, label }: { keys: string; label: string }) => (
  <span className="flex items-center gap-1">
    <kbd className="rounded border border-border/40 bg-muted/30 px-1 font-mono text-[10px]">
      {keys}
    </kbd>
    {label}
  </span>
);

// Calm network-blue accent for every row icon (ports don't have a per-row
// activity state like sessions do — a listening socket is just "open").
const PORT_ICON_COLOR = "hsl(200 70% 58%)";

// Trailing slot is a fixed 20px box whether it holds the kill button or the
// killing spinner, so the port/owner/meta never shift as the slot's content
// changes between rows or states.
const TRAILING_SLOT_CLASSES = "flex size-5 shrink-0 items-center justify-center";

interface PortOptionProps {
  port: ListeningPort;
  optionId: string;
  isActive: boolean;
  isKilling: boolean;
  onSetActive: () => void;
  onKill: () => void;
}

// A port row rendered as a command-palette option: the port number (bold mono)
// on the left as the identity, the owning session's title/path taking the
// flex-1 truncation slack, the process name + bind address right-aligned in a
// mono meta column (hidden on mobile so the row stays a one-liner on a phone),
// and an always-visible stop button trailing. The row itself is informational
// (no click action) — stopping a dev server is an explicit, deliberate action
// via the stop button (or Enter on the highlighted row) so an accidental tap
// never kills a running server. The stop button is always shown, not
// hover-gated like the sessions modal's kill X, because a touch device has no
// hover to reveal it and stopping a dev server is this modal's whole purpose.

const PortOption = ({
  port,
  optionId,
  isActive,
  isKilling,
  onSetActive,
  onKill,
}: PortOptionProps) => (
  <div
    role="option"
    id={optionId}
    aria-selected={isActive}
    onMouseMove={onSetActive}
    className={cn(
      "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-xs outline-none transition-colors",
      isActive ? "bg-foreground/10 text-foreground" : "text-muted-foreground",
    )}
  >
    <Network className="size-3.5 shrink-0" aria-hidden="true" style={{ color: PORT_ICON_COLOR }} />
    <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-foreground">
      {port.port}
    </span>
    <span className="min-w-0 flex-1 truncate text-left text-muted-foreground/70">
      {port.sessionTitle || port.cwd}
    </span>
    <span className="hidden shrink-0 items-center gap-2 font-mono text-[10px] tabular-nums text-muted-foreground/60 sm:flex">
      <span>{port.processName}</span>
      <span>{port.address}</span>
    </span>
    {isKilling ? (
      <span className={TRAILING_SLOT_CLASSES}>
        <Spinner className="size-3.5" aria-label="stopping port" />
      </span>
    ) : (
      <button
        type="button"
        aria-label={`stop ${port.processName} on port ${port.port}`}
        title="Stop this dev server"
        onClick={(event) => {
          event.stopPropagation();
          onKill();
        }}
        className={cn(
          TRAILING_SLOT_CLASSES,
          "rounded-sm text-muted-foreground transition-colors hover:text-foreground",
        )}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    )}
  </div>
);

const matchesQuery = (port: ListeningPort, query: string): boolean => {
  if (!query) return true;
  return (
    String(port.port).includes(query) ||
    port.processName.toLowerCase().includes(query) ||
    port.address.toLowerCase().includes(query) ||
    port.sessionTitle.toLowerCase().includes(query) ||
    port.cwd.toLowerCase().includes(query)
  );
};

export const PortsModal = ({ open, isTouchDevice, onClose }: PortsModalProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [ports, setPorts] = useState<ListeningPort[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [killingPid, setKillingPid] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const refresh = useCallback(async () => {
    const fetched = await fetchPorts();
    if (fetched === null) {
      setHasError(true);
      return;
    }
    setHasError(false);
    setPorts(fetched);
  }, []);

  // Mount/unmount mirroring the command palette + sessions modal: CSS
  // transitions on data-open/data-closed (fade + scale from the top so the
  // search bar stays anchored) with a 150ms settle window. An interrupted open
  // animates back out with no flicker.
  useEffect(() => {
    if (open) {
      setMounted(true);
      setQuery("");
      setActiveIndex(0);
      setKillingPid(null);
      const frame = requestAnimationFrame(() => {
        setSettled(true);
        searchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    const timer = window.setTimeout(() => setMounted(false), PORTS_MODAL_CLOSE_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    // Poll while open so the list reflects a dev server starting or stopping in
    // near-realtime — the ports list is live state, not a snapshot.
    const tick = window.setInterval(() => void refresh(), PORTS_POLL_INTERVAL_MS);
    return () => window.clearInterval(tick);
  }, [open, refresh]);

  // Escape closes (capture phase, winning over the terminal's own handling
  // while the modal is up).
  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, mounted, onClose]);

  const normalizedQuery = query.trim().toLowerCase();
  const ordered = useMemo(
    () => (ports ? ports.filter((port) => matchesQuery(port, normalizedQuery)) : []),
    [ports, normalizedQuery],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  // A poll that shrinks the list (a dev server stopped in another tab) must
  // not leave activeIndex pointing past the end. Clamp to the new tail.
  useEffect(() => {
    setActiveIndex((prev) => (ordered.length === 0 ? 0 : Math.min(prev, ordered.length - 1)));
  }, [ordered.length]);

  // Keep the highlighted row scrolled into view across keyboard navigation.
  useEffect(() => {
    if (!open || ordered.length === 0) return;
    const active = ordered[activeIndex];
    if (active) {
      document.getElementById(`${listId}-${active.pid}:${active.port}`)?.scrollIntoView?.({
        block: "nearest",
      });
    }
  }, [activeIndex, ordered, open, listId]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setKillingPid(null);
    }
  }, [open]);

  const handleConfirmKill = async (port: ListeningPort) => {
    setKillingPid(port.pid);
    await killPort(port.pid);
    setKillingPid(null);
    await refresh();
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    const count = ordered.length;
    const isNext = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n");
    const isPrev = event.key === "ArrowUp" || (event.ctrlKey && event.key === "p");
    if (isNext || isPrev) {
      event.preventDefault();
      if (count === 0) return;
      setActiveIndex((prev) => (prev + (isNext ? 1 : -1) + count) % count);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = ordered[activeIndex];
      if (target) void handleConfirmKill(target);
    }
  };

  if (!mounted) return null;

  const isVisible = open && settled;

  // The list body lives in a height-reserved inner div (mirroring the worktrees
  // modal) so the palette panel opens at a stable height and grows smoothly to
  // the list instead of flashing a centered spinner that then swaps for the
  // list. During the initial load the body is empty with one row reserved; once
  // the fetch lands the height transitions to N rows, and the content fades in.
  const listHeightPx =
    hasError || (ports !== null && ordered.length === 0)
      ? PORTS_MESSAGE_BLOCK_MIN_HEIGHT_PX
      : Math.max(PORTS_LIST_ROW_HEIGHT_PX, ordered.length * PORTS_LIST_ROW_HEIGHT_PX);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
      <div
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(COMMAND_PALETTE_BACKDROP_CLASSES)}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="open ports"
        aria-modal
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(
          "relative z-10 flex w-[520px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl origin-top",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
        style={{ maxHeight: PALETTE_MODAL_MAX_HEIGHT_PX }}
      >
        <div className="flex items-center border-b border-border/40 px-4">
          <Search className="size-4 shrink-0 text-muted-foreground/60" />
          <input
            ref={searchInputRef}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search ports by number, process, or session…"
            aria-label="search open ports"
            aria-activedescendant={
              ordered[activeIndex]
                ? `${listId}-${ordered[activeIndex].pid}:${ordered[activeIndex].port}`
                : undefined
            }
            aria-controls={listId}
            aria-expanded
            aria-haspopup="listbox"
            role="combobox"
            className="h-9 w-full bg-transparent px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          {ports === null && !hasError ? (
            <Spinner className="size-3.5 shrink-0" aria-label="loading ports" />
          ) : ports ? (
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
              {ports.length}
            </span>
          ) : null}
        </div>
        <div
          id={listId}
          role="listbox"
          className="flex-1 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            className="relative transition-[height] duration-150 ease-snappy"
            style={{ height: listHeightPx }}
          >
            {hasError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-2.5 text-xs text-muted-foreground/70">
                Couldn't load ports from the localterm daemon.
                <Button variant="outline" size="xs" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            ) : ports === null ? null : ordered.length === 0 ? (
              <div className="animate-in fade-in-0 duration-150 ease-snappy absolute inset-0 flex flex-col items-center justify-center px-2.5 text-center text-xs text-muted-foreground/70">
                {query ? (
                  <>No ports match “{query}”.</>
                ) : (
                  <>
                    No listening dev ports from localterm sessions.
                    <span className="mt-1 block text-[11px] text-muted-foreground/60">
                      Run a dev server (e.g. `npm run dev`) in a shell and it shows up here.
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="animate-in fade-in-0 duration-150 ease-snappy">
                {ordered.map((port, index) => (
                  <PortOption
                    key={`${port.pid}:${port.port}`}
                    port={port}
                    optionId={`${listId}-${port.pid}:${port.port}`}
                    isActive={index === activeIndex}
                    isKilling={killingPid === port.pid}
                    onSetActive={() => {
                      if (index !== activeIndex) setActiveIndex(index);
                    }}
                    onKill={() => void handleConfirmKill(port)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-border/40 px-4 py-1.5 text-[10px] text-muted-foreground/60">
          {isTouchDevice ? null : (
            <>
              <KeyHint keys="↑↓" label="navigate" />
              <KeyHint keys="↵" label="stop" />
              <KeyHint keys="esc" label="close" />
            </>
          )}
          <span className="ml-auto">
            {ordered.length} {ordered.length === 1 ? "port" : "ports"}
          </span>
        </div>
      </div>
    </div>
  );
};
