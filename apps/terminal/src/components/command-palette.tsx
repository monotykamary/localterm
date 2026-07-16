import { Check, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import { COMMAND_PALETTE_CLOSE_TRANSITION_MS, PALETTE_MODAL_MAX_HEIGHT_PX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { fuzzyMatch, fuzzyMaxScore, type QueryMatch } from "@/utils/fuzzy-match";

export interface CommandItem {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  icon?: React.ReactNode;
  /** Marks the currently active option (theme, font, …) or an enabled toggle. */
  checked?: boolean;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: readonly CommandItem[];
  /**
   * Fires when the highlighted command changes, and with null when the
   * palette closes or nothing is highlighted. Lets the host live-preview
   * settings (theme, font) while the user navigates.
   */
  onActiveItemChange?: (item: CommandItem | null) => void;
}

const COMMAND_ITEM_CLASSES =
  "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-xs text-muted-foreground outline-none transition-colors";

// Matches that hit the label directly always rank above matches that only
// succeed against "category label", whatever their individual scores.
const CATEGORY_MATCH_PENALTY = 10;

const matchQuery = (query: string, text: string): QueryMatch | null => {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct !== -1) {
    const indices = Array.from({ length: q.length }, (_, i) => direct + i);
    if (t === q) return { score: 1, indices };
    if (direct === 0) return { score: 2, indices };
    return { score: 3, indices };
  }
  const fuzzy = fuzzyMatch(q, t);
  if (!fuzzy) return null;
  const normalized = fuzzy.score / fuzzyMaxScore(q.length);
  return { score: 4 + (1 - normalized), indices: fuzzy.indices };
};

interface FilteredEntry {
  cmd: CommandItem;
  indices: readonly number[] | null;
}

const filterCommands = (commands: readonly CommandItem[], query: string): FilteredEntry[] => {
  if (!query) return commands.map((cmd) => ({ cmd, indices: null }));
  return commands
    .flatMap((cmd): (FilteredEntry & { score: number })[] => {
      const labelMatch = matchQuery(query, cmd.label);
      if (labelMatch) return [{ cmd, score: labelMatch.score, indices: labelMatch.indices }];
      const categoryMatch = matchQuery(query, `${cmd.category} ${cmd.label}`);
      if (categoryMatch) {
        return [{ cmd, score: CATEGORY_MATCH_PENALTY + categoryMatch.score, indices: null }];
      }
      return [];
    })
    .sort((a, b) => a.score - b.score)
    .map(({ cmd, indices }) => ({ cmd, indices }));
};

const HighlightedLabel = ({
  label,
  indices,
}: {
  label: string;
  indices: readonly number[] | null;
}) => {
  if (!indices || indices.length === 0) return <>{label}</>;
  const hits = new Set(indices);
  const segments: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < label.length; i++) {
    const hit = hits.has(i);
    const last = segments[segments.length - 1];
    if (last && last.hit === hit) last.text += label[i];
    else segments.push({ text: label[i], hit });
  }
  return (
    <>
      {segments.map((segment, segmentIndex) => (
        <span
          key={segmentIndex}
          className={segment.hit ? "font-semibold text-foreground" : undefined}
        >
          {segment.text}
        </span>
      ))}
    </>
  );
};

const KeyHint = ({ keys, label }: { keys: string; label: string }) => (
  <span className="flex items-center gap-1">
    <kbd className="rounded border border-border/40 bg-muted/30 px-1 font-mono text-[10px]">
      {keys}
    </kbd>
    {label}
  </span>
);

export const CommandPalette = ({
  open,
  onClose,
  commands,
  onActiveItemChange,
}: CommandPaletteProps) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  const groups = useMemo(() => {
    const result: { category: string; entries: { entry: FilteredEntry; index: number }[] }[] = [];
    filtered.forEach((entry, index) => {
      const last = result[result.length - 1];
      if (last && last.category === entry.cmd.category) last.entries.push({ entry, index });
      else result.push({ category: entry.cmd.category, entries: [{ entry, index }] });
    });
    return result;
  }, [filtered]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setQuery("");
      setActiveIndex(0);
      const frame = requestAnimationFrame(() => {
        setSettled(true);
        // autoFocus only fires on first mount; refocus explicitly when the
        // palette reopens while the close animation is still unmounting.
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), COMMAND_PALETTE_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!onActiveItemChange) return;
    onActiveItemChange(open ? (filtered[activeIndex]?.cmd ?? null) : null);
  }, [open, filtered, activeIndex, onActiveItemChange]);

  useEffect(() => {
    const cmd = filtered[activeIndex]?.cmd;
    if (!open || !cmd) return;
    document.getElementById(`${listId}-${cmd.id}`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, filtered, open, listId]);

  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, mounted, onClose]);

  const executeActive = useCallback(() => {
    const cmd = filtered[activeIndex]?.cmd;
    if (!cmd) return;
    onClose();
    cmd.action();
  }, [activeIndex, filtered, onClose]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const count = filtered.length;
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
        executeActive();
        return;
      }
    },
    [executeActive, filtered.length],
  );

  if (!mounted) return null;

  const isVisible = open && settled;

  const renderOption = (entry: FilteredEntry, index: number, showCategory: boolean) => {
    const { cmd, indices } = entry;
    return (
      <button
        key={cmd.id}
        id={`${listId}-${cmd.id}`}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        className={cn(
          COMMAND_ITEM_CLASSES,
          index === activeIndex && "bg-foreground/10 text-foreground",
        )}
        onMouseMove={() => {
          if (index !== activeIndex) setActiveIndex(index);
        }}
        onClick={() => {
          onClose();
          cmd.action();
        }}
      >
        {cmd.icon ? (
          <span className="shrink-0 text-muted-foreground/70">{cmd.icon}</span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="flex-1 truncate text-left">
          <HighlightedLabel label={cmd.label} indices={indices} />
        </span>
        {showCategory ? (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/50">
            {cmd.category}
          </span>
        ) : null}
        {cmd.checked ? <Check aria-label="active" className="size-3.5 shrink-0" /> : null}
        {cmd.shortcut ? (
          <kbd className="shrink-0 rounded border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
            {cmd.shortcut}
          </kbd>
        ) : null}
      </button>
    );
  };

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
        aria-label="command palette"
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
            ref={inputRef}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command…"
            aria-label="search commands"
            aria-activedescendant={
              filtered[activeIndex] ? `${listId}-${filtered[activeIndex].cmd.id}` : undefined
            }
            aria-controls={listId}
            aria-expanded
            aria-haspopup="listbox"
            role="combobox"
            className="h-9 w-full bg-transparent px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <div
          id={listId}
          role="listbox"
          className="flex-1 animate-in fade-in-0 duration-150 ease-snappy overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {filtered.length === 0 ? (
            <div className="px-2.5 py-6 text-center text-xs text-muted-foreground/70">
              No commands match “{query}”
            </div>
          ) : query ? (
            filtered.map((entry, index) => renderOption(entry, index, true))
          ) : (
            groups.map((group) => (
              <div key={group.category} role="group" aria-label={group.category}>
                <div className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
                  {group.category}
                </div>
                {group.entries.map(({ entry, index }) => renderOption(entry, index, false))}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border/40 px-4 py-1.5 text-[10px] text-muted-foreground/60">
          <KeyHint keys="↑↓" label="navigate" />
          <KeyHint keys="↵" label="run" />
          <KeyHint keys="esc" label="close" />
          <span className="ml-auto">
            {filtered.length} {filtered.length === 1 ? "command" : "commands"}
          </span>
        </div>
      </div>
    </div>
  );
};
