import { Check, Plus, Search, SquareTerminal, X } from "lucide-react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import {
  PALETTE_MODAL_MAX_HEIGHT_PX,
  SESSIONS_LIST_ROW_HEIGHT_PX,
  SESSIONS_MAX_PEER_DOTS,
  SESSIONS_MESSAGE_BLOCK_MIN_HEIGHT_PX,
  SESSIONS_MODAL_CLOSE_TRANSITION_MS,
  SESSIONS_POLL_INTERVAL_MS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type {
  SessionActivityState,
  SessionListItem,
} from "@monotykamary/localterm-server/protocol";
import { fetchSessions, killSession } from "@/utils/fetch-sessions";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { resolveInitialSessionIndex } from "@/utils/resolve-initial-session-index";
import { sortSessions } from "@/utils/sort-sessions";
import { hueForWindowId } from "@/utils/hue-for-window-id";
import { loadWindowId } from "@/utils/window-id";

interface SessionsModalProps {
  open: boolean;
  liveSessionIdRef: RefObject<string | null>;
  previousSessionIdRef: RefObject<string | null>;
  switchSessionRef: RefObject<((sid: string) => void) | null>;
  isTouchDevice: boolean;
  onOpenNewShell: () => void;
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

// A session row rendered as a command-palette option: icon + title (truncate)
// on the left, the status pill and shell/pid/age detail on the right, a
// hover-revealed kill button, and a Check when this is the tab's current
// session. The meta is split into fixed min-width columns anchored from the
// right so the parts can't shift each other as their widths change: the age
// (the only piece that changes over time) lives in its own right-aligned
// column flush to the action, so a longer/shorter age only slides within
// that column and never drags the shell name, pid, or pill with it. The pid
// column is also right-aligned so its right edge is pinned. The shell name
// stays content-width so it still hugs the pill — its right edge is
// columnized anyway (pinned by the fixed pid/age chain to its right) and it
// grows leftward for long names. The pieces are separated by the column gap
// rather than dot separators, so there's no artificial gap after a dot.
// The whole meta group is right-justified (flush to the action slot); the
// title's flex-1 truncation absorbs the remaining slack on the left.
// The current session can't be killed (it's the one this tab is viewing).
interface SessionOptionProps {
  session: SessionListItem;
  optionId: string;
  isCurrent: boolean;
  isActive: boolean;
  nowMs: number;
  windowId: string;
  isKilling: boolean;
  onSetActive: () => void;
  onSwitch: () => void;
  onKill: () => void;
}

// Favicon-equivalent colors, tuned for the session list's darker
// foreground/10 row surface (the favicon fills sit on a near-black tab bar).
// running ≈ the green favicon; alive-quiet ≈ the blue favicon; ready ≈ the
// grey favicon. Picked for contrast on the list, not byte-matched to the SVG.
const ICON_COLOR_FOR_STATE: Record<SessionActivityState, string> = {
  running: "hsl(142 60% 50%)",
  "alive-quiet": "hsl(200 70% 58%)",
  ready: "hsl(220 8% 55%)",
};

const SessionIcon = ({ state }: { state: SessionActivityState }) => (
  <SquareTerminal
    className="size-3.5"
    aria-hidden="true"
    style={{ color: ICON_COLOR_FOR_STATE[state] }}
  />
);

// Peer cluster: one solid dot per attached client, grouped by browser
// profile. The picker's own profile leads and renders in the foreground color
// ("me"), each other profile gets a stable hue derived from its id, and a
// back-compat client with no profile id groups under a muted neutral. Dots
// within a profile touch; a wider gap separates profiles — so the cluster
// reads at a glance as "two of mine, one of another profile." A dormant shell
// (no viewers) shows a single hollow dot, distinct from a 1-peer solid dot;
// the activity icon already says what the shell is doing, this says who's
// watching it. Beyond SESSIONS_MAX_PEER_DOTS the tail collapses into "+N" so a
// busy row can't overflow. Distinct from the trailing Check, which marks the
// row this tab is currently viewing (orthogonal — a session can be current
// and have peers, or be a peer-only row another of this profile's tabs views).
const PeerDot = ({ windowId, ownWindowId }: { windowId: string; ownWindowId: string }) => {
  const isSelf = ownWindowId !== "" && windowId === ownWindowId;
  const isUnknown = windowId === "";
  return (
    <span
      aria-hidden="true"
      style={
        isSelf || isUnknown
          ? undefined
          : { backgroundColor: `hsl(${hueForWindowId(windowId)} 55% 55%)` }
      }
      className={cn(
        "size-1.5 rounded-full",
        isSelf && "bg-foreground",
        isUnknown && "bg-foreground/30",
      )}
    />
  );
};

const PeerDots = ({ session, windowId }: { session: SessionListItem; windowId: string }) => {
  const total = session.clients;
  if (total === 0) {
    return (
      <span
        className="flex shrink-0 items-center"
        aria-label="no peers attached (dormant)"
        title="No one is viewing this shell"
      >
        <span className="size-1.5 rounded-full ring-1 ring-foreground/25" aria-hidden="true" />
      </span>
    );
  }
  const groups = (session.clientProfiles ?? [{ windowId: "", count: total }]).slice();
  groups.sort((a, b) => {
    const aSelf = a.windowId !== "" && a.windowId === windowId;
    const bSelf = b.windowId !== "" && b.windowId === windowId;
    if (aSelf !== bSelf) return aSelf ? -1 : 1;
    return b.count - a.count;
  });
  const renderedGroups: ReactNode[] = [];
  let rendered = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    if (rendered >= SESSIONS_MAX_PEER_DOTS) break;
    const group = groups[groupIndex];
    const dots: ReactNode[] = [];
    for (
      let dotIndex = 0;
      dotIndex < group.count && rendered < SESSIONS_MAX_PEER_DOTS;
      dotIndex += 1
    ) {
      dots.push(<PeerDot key={dotIndex} windowId={group.windowId} ownWindowId={windowId} />);
      rendered += 1;
    }
    renderedGroups.push(
      <span key={group.windowId || groupIndex} className="flex items-center gap-px">
        {dots}
      </span>,
    );
  }
  const overflow = total - rendered;
  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      aria-label={`${total} ${total === 1 ? "peer" : "peers"} attached`}
      title={`${total} ${total === 1 ? "peer" : "peers"} attached`}
    >
      {renderedGroups}
      {overflow > 0 && (
        <span className="font-mono text-[9px] tabular-nums text-muted-foreground/60">
          +{overflow}
        </span>
      )}
    </span>
  );
};

// Trailing slot is a fixed 20px box whether it holds a Check (current), a
// Spinner (killing), or a kill button — so the title/meta never shift as the
// slot's content changes between rows or states.
const TRAILING_SLOT_CLASSES = "flex size-5 shrink-0 items-center justify-center";

const SessionOption = ({
  session,
  optionId,
  isCurrent,
  isActive,
  nowMs,
  windowId,
  isKilling,
  onSetActive,
  onSwitch,
  onKill,
}: SessionOptionProps) => (
  <div
    role="option"
    id={optionId}
    aria-selected={isActive}
    onMouseMove={onSetActive}
    onClick={onSwitch}
    className={cn(
      "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm outline-none transition-colors",
      isActive ? "bg-foreground/10 text-foreground" : "text-muted-foreground",
      isCurrent && "cursor-default",
    )}
  >
    <SessionIcon state={session.state} />
    <span className="min-w-0 flex-1 truncate text-left">{session.title || session.cwd}</span>
    <PeerDots session={session} windowId={windowId} />
    <span className="hidden shrink-0 items-center font-mono text-[10px] tabular-nums text-muted-foreground/60 sm:flex">
      <span className="min-w-[3rem] text-right">
        {formatRelativeTime(session.createdAt, nowMs)}
      </span>
    </span>
    {isCurrent ? (
      <span className={TRAILING_SLOT_CLASSES}>
        <Check aria-label="current session" className="size-3.5" />
      </span>
    ) : isKilling ? (
      <span className={TRAILING_SLOT_CLASSES}>
        <Spinner className="size-3.5" aria-label="killing session" />
      </span>
    ) : (
      <button
        type="button"
        aria-label={`kill ${session.title || session.cwd}`}
        title="Kill this shell"
        onClick={(event) => {
          event.stopPropagation();
          onKill();
        }}
        className={cn(
          TRAILING_SLOT_CLASSES,
          "rounded-sm text-muted-foreground transition-colors hover:text-foreground",
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    )}
  </div>
);

export const SessionsModal = ({
  open,
  liveSessionIdRef,
  previousSessionIdRef,
  switchSessionRef,
  isTouchDevice,
  onOpenNewShell,
  onClose,
}: SessionsModalProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [killingId, setKillingId] = useState<string | null>(null);
  // This tab's per-browser-profile handle (minted into localStorage, shared by
  // every tab of this profile). Stable for the tab's life, so the picker can
  // color its own peer dots and cluster its profile's sessions without a
  // server round-trip — it already knows its own id.
  const [windowId] = useState(() => loadWindowId());
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Latched on open so the picker applies its initial highlight (the last
  // switched session) once the list lands, not on every poll refresh.
  const openSelectionPendingRef = useRef(false);

  const refresh = useCallback(async () => {
    const fetched = await fetchSessions();
    if (fetched === null) {
      setHasError(true);
      return;
    }
    setHasError(false);
    setSessions(fetched);
    setNowMs(Date.now());
  }, []);

  // Mount/unmount mirroring the command palette: CSS transitions on
  // data-open/data-closed (fade + scale from the top so the search bar stays
  // anchored) with a 150ms settle window. An interrupted open animates back out
  // with no flicker.
  useEffect(() => {
    if (open) {
      setMounted(true);
      setQuery("");
      setActiveIndex(0);
      openSelectionPendingRef.current = true;
      const frame = requestAnimationFrame(() => {
        setSettled(true);
        searchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), SESSIONS_MODAL_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    // Poll while open so the list reflects attaches, detaches, and grace reaps
    // in near-realtime — the sessions list is live state, not a snapshot.
    const tick = window.setInterval(() => void refresh(), SESSIONS_POLL_INTERVAL_MS);
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

  const currentId = liveSessionIdRef.current;
  const normalizedQuery = query.trim().toLowerCase();
  const ordered = useMemo(
    () => (sessions ? sortSessions(sessions, currentId, normalizedQuery, windowId) : []),
    [sessions, currentId, normalizedQuery, windowId],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  // A poll that shrinks the list (a grace reap, a kill from another tab) must
  // not leave activeIndex pointing past the end. Clamp to the new tail.
  useEffect(() => {
    setActiveIndex((prev) => (ordered.length === 0 ? 0 : Math.min(prev, ordered.length - 1)));
  }, [ordered.length]);

  // On open, jump the highlight to the last switched session (the shell this
  // tab viewed before the current) so opening the picker and pressing Enter
  // quick-switches back, alt-tab style. Applies once per open — after the
  // list lands — not on every poll refresh or query change.
  useEffect(() => {
    if (!open || !openSelectionPendingRef.current || ordered.length === 0) return;
    openSelectionPendingRef.current = false;
    setActiveIndex(
      resolveInitialSessionIndex(ordered, previousSessionIdRef.current, liveSessionIdRef.current),
    );
  }, [open, ordered]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setKillingId(null);
    }
  }, [open]);

  const virtualizer = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => SESSIONS_LIST_ROW_HEIGHT_PX,
    overscan: 8,
    getItemKey: (index) => ordered[index].id,
  });

  // Keep the highlighted row scrolled into view across keyboard navigation.
  // The virtualizer only renders visible rows, so scrollIntoView-by-id (as the
  // command palette does) wouldn't reach off-screen rows — scrollToIndex does.
  useEffect(() => {
    if (!open || ordered.length === 0) return;
    virtualizer.scrollToIndex(activeIndex, { align: "auto" });
  }, [activeIndex, ordered.length, open, virtualizer]);

  const handleSwitch = (session: SessionListItem) => {
    if (session.id === liveSessionIdRef.current) return;
    switchSessionRef.current?.(session.id);
    onClose();
  };

  const handleConfirmKill = async (session: SessionListItem) => {
    setKillingId(session.id);
    await killSession(session.id);
    setKillingId(null);
    await refresh();
  };

  const handleOpenNewShell = () => {
    onOpenNewShell();
    onClose();
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
      if (target) handleSwitch(target);
    }
  };

  if (!mounted) return null;

  const isVisible = open && settled;

  // The list body lives in a height-reserved inner div (mirroring the worktrees
  // and ports modals) so the palette panel opens at a stable height and grows
  // smoothly to the list instead of flashing a centered spinner that then swaps
  // for the list. During the initial load the body is empty with one row
  // reserved; once the fetch lands the height transitions to the virtualized
  // list's total size, and the content fades in.
  const listHeightPx =
    hasError || (sessions !== null && ordered.length === 0)
      ? SESSIONS_MESSAGE_BLOCK_MIN_HEIGHT_PX
      : Math.max(SESSIONS_LIST_ROW_HEIGHT_PX, virtualizer.getTotalSize());

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
        aria-label="sessions"
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
            placeholder="Search sessions by title, path, or shell…"
            aria-label="search sessions"
            aria-activedescendant={
              ordered[activeIndex] ? `sessions-${ordered[activeIndex].id}` : undefined
            }
            aria-controls="sessions-list"
            aria-expanded
            aria-haspopup="listbox"
            role="combobox"
            className="h-12 w-full bg-transparent px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          {sessions === null && !hasError ? (
            <Spinner className="size-3.5 shrink-0" aria-label="loading sessions" />
          ) : sessions ? (
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
              {sessions.length}
            </span>
          ) : null}
        </div>
        <div
          id="sessions-list"
          role="listbox"
          ref={listScrollRef}
          className="flex-1 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            className="relative transition-[height] duration-150 ease-snappy"
            style={{ height: listHeightPx }}
          >
            {hasError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-2.5 text-sm text-muted-foreground/70">
                Couldn't load sessions from the localterm daemon.
                <Button variant="outline" size="xs" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            ) : sessions === null ? null : ordered.length === 0 ? (
              <div className="animate-in fade-in-0 duration-150 ease-snappy absolute inset-0 flex flex-col items-center justify-center px-2.5 text-center text-sm text-muted-foreground/70">
                {query ? (
                  <>No sessions match “{query}”.</>
                ) : (
                  <>
                    No live shells. Open a new tab to start one.
                    <span className="mt-1 block text-[11px] text-muted-foreground/60">
                      A closed tab's shell waits here for ~30s before it's reaped.
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div
                className="animate-in fade-in-0 duration-150 ease-snappy"
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow: VirtualItem) => {
                  const session = ordered[virtualRow.index];
                  const isCurrent = session.id === currentId;
                  return (
                    <div
                      key={session.id}
                      ref={virtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="group"
                      style={
                        {
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        } satisfies CSSProperties
                      }
                    >
                      <SessionOption
                        session={session}
                        optionId={`sessions-${session.id}`}
                        isCurrent={isCurrent}
                        isActive={virtualRow.index === activeIndex}
                        nowMs={nowMs}
                        windowId={windowId}
                        isKilling={killingId === session.id}
                        onSetActive={() => {
                          if (virtualRow.index !== activeIndex) setActiveIndex(virtualRow.index);
                        }}
                        onSwitch={() => handleSwitch(session)}
                        onKill={() => void handleConfirmKill(session)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-border/40 px-4 py-1.5 text-[10px] text-muted-foreground/60">
          {isTouchDevice ? null : (
            <>
              <KeyHint keys="↑↓" label="navigate" />
              <KeyHint keys="↵" label="switch" />
              <KeyHint keys="esc" label="close" />
            </>
          )}
          <span className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="xs" onClick={handleOpenNewShell}>
              <Plus aria-hidden="true" />
              New shell
            </Button>
            {ordered.length} {ordered.length === 1 ? "session" : "sessions"}
          </span>
        </div>
      </div>
    </div>
  );
};
