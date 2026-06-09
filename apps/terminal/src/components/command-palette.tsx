import { Search } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import { COMMAND_PALETTE_CLOSE_TRANSITION_MS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface CommandItem {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  icon?: React.ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: readonly CommandItem[];
}

const COMMAND_ITEM_CLASSES =
  "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm outline-none transition-colors";

const scoreQueryMatch = (query: string, label: string): number => {
  const lower = label.toLowerCase();
  const q = query.toLowerCase();
  if (lower === q) return 1;
  if (lower.startsWith(q)) return 2;
  if (lower.includes(q)) return 3;
  const fzy = fuzzyScore(query, label);
  if (fzy > 0) return 4 + (1 - fzy);
  return 0;
};

const fuzzyScore = (query: string, text: string): number => {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatchIndex = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1;
      if (lastMatchIndex === ti - 1) score += 0.5;
      if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "-") score += 0.5;
      lastMatchIndex = ti;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
};

export const CommandPalette = ({ open, onClose, commands }: CommandPaletteProps) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const filtered = query
    ? commands
        .map((cmd) => ({ cmd, score: scoreQueryMatch(query, cmd.label) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => a.score - b.score)
        .map((entry) => entry.cmd)
    : commands;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setQuery("");
      setActiveIndex(0);
      const frame = requestAnimationFrame(() => setSettled(true));
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
    if (!open || filtered.length === 0) return;
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filtered.length, open]);

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
    const cmd = filtered[activeIndex];
    if (!cmd) return;
    onClose();
    cmd.action();
  }, [activeIndex, filtered, onClose]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (prev) => (prev - 1 + Math.max(1, filtered.length)) % Math.max(1, filtered.length),
        );
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
          "relative z-10 w-[460px] max-h-[360px] flex flex-col overflow-hidden rounded-xl",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
      >
        <div className="flex items-center border-b border-border/40 px-3">
          <Search className="size-4 shrink-0 text-muted-foreground/60" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command…"
            aria-label="search commands"
            aria-activedescendant={
              filtered[activeIndex] ? `${listId}-${filtered[activeIndex].id}` : undefined
            }
            aria-controls={listId}
            aria-expanded
            aria-haspopup="listbox"
            role="combobox"
            className="h-10 w-full bg-transparent px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="flex-1 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {filtered.length === 0 ? (
            <div className="px-2.5 py-6 text-center text-sm text-muted-foreground/70">
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, index) => (
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
                onMouseEnter={() => setActiveIndex(index)}
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
                <span className="flex-1 text-left">{cmd.label}</span>
                {cmd.shortcut ? (
                  <kbd className="shrink-0 rounded border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
                    {cmd.shortcut}
                  </kbd>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
