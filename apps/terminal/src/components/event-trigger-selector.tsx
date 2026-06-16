import type { AutomationSessionEvent } from "@monotykamary/localterm-server/protocol";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface EventTriggerSelectorProps {
  selected: AutomationSessionEvent[];
  options: readonly AutomationSessionEvent[];
  labels: Record<AutomationSessionEvent, string>;
  descriptions: Record<AutomationSessionEvent, string>;
  onChange: (selected: AutomationSessionEvent[]) => void;
  placeholder?: string;
}

export const EventTriggerSelector = ({
  selected,
  options,
  labels,
  descriptions,
  onChange,
  placeholder = "Select events…",
}: EventTriggerSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const availableOptions = useMemo(
    () => options.filter((event) => !selected.includes(event)),
    [options, selected],
  );

  const filteredOptions = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    if (trimmedQuery.length === 0) return availableOptions;
    return availableOptions.filter(
      (event) =>
        labels[event].toLowerCase().includes(trimmedQuery) ||
        descriptions[event].toLowerCase().includes(trimmedQuery),
    );
  }, [availableOptions, query, labels, descriptions]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, filteredOptions.length]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlightedIndex(0);
    }
  }, [open]);

  const addEvent = (event: AutomationSessionEvent) => {
    onChange([...selected, event]);
    setQuery("");
    inputRef.current?.focus();
  };

  const removeEvent = (event: AutomationSessionEvent) => {
    onChange(selected.filter((value) => value !== event));
  };

  const removeLastEvent = () => {
    if (query.length > 0 || selected.length === 0) return;
    onChange(selected.slice(0, -1));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(filteredOptions.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[highlightedIndex];
      if (option !== undefined) addEvent(option);
      return;
    }
    if (event.key === "Backspace" && query.length === 0) {
      removeLastEvent();
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={
          <div
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            tabIndex={0}
            className={cn(
              "flex min-h-7 w-full flex-wrap items-center gap-1 rounded-sm border border-border/50 bg-background px-1.5 py-1 text-left outline-none transition-colors hover:border-border focus-visible:border-ring",
              open && "border-ring",
            )}
          />
        }
      >
        {selected.length === 0 ? (
          <span className="text-xs text-muted-foreground/70">{placeholder}</span>
        ) : (
          selected.map((event) => (
            <span
              key={event}
              className="inline-flex items-center gap-0.5 rounded-sm bg-foreground/10 px-1.5 py-0.5 text-[11px] text-foreground"
            >
              {labels[event]}
              <button
                type="button"
                onClick={(clickEvent) => {
                  clickEvent.stopPropagation();
                  removeEvent(event);
                }}
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${labels[event]}`}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" initialFocus={inputRef}>
        <div className="flex items-center gap-1.5 border-b border-border/40 px-2 py-1.5">
          <Search className="size-3 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(changeEvent) => setQuery(changeEvent.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search events…"
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div
          className="max-h-60 overflow-y-auto overscroll-contain p-1"
          role="listbox"
          aria-label="Events"
        >
          {filteredOptions.length === 0 ? (
            <p className="px-2 py-2 text-center text-xs text-muted-foreground">
              {query.trim().length > 0 ? "No events match your search." : "All events selected."}
            </p>
          ) : (
            filteredOptions.map((event, index) => (
              <button
                key={event}
                type="button"
                role="option"
                aria-selected={index === highlightedIndex}
                onClick={() => addEvent(event)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none transition-colors",
                  index === highlightedIndex
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5",
                )}
              >
                <span className="text-xs">{labels[event]}</span>
                <span className="text-[10px] text-muted-foreground/80">{descriptions[event]}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
