import type { SecretEntryResponse } from "@monotykamary/localterm-server/protocol";
import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface SecretSelectorProps {
  selected: string[];
  options: SecretEntryResponse[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

export const SecretSelector = ({
  selected,
  options,
  onChange,
  placeholder = "Select secrets…",
}: SecretSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const availableOptions = useMemo(
    () => options.filter((secret) => !selectedSet.has(secret.name)),
    [options, selectedSet],
  );

  const filteredOptions = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    if (trimmedQuery.length === 0) return availableOptions;
    return availableOptions.filter(
      (secret) =>
        secret.name.toLowerCase().includes(trimmedQuery) ||
        secret.envVar.toLowerCase().includes(trimmedQuery),
    );
  }, [availableOptions, query]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, filteredOptions.length]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlightedIndex(0);
    }
  }, [open]);

  const addSecret = (name: string) => {
    onChange([...selected, name]);
    setQuery("");
    inputRef.current?.focus();
  };

  const removeSecret = (name: string) => {
    onChange(selected.filter((value) => value !== name));
  };

  const removeLastSecret = () => {
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
      if (option !== undefined) addSecret(option.name);
      return;
    }
    if (event.key === "Backspace" && query.length === 0) {
      removeLastSecret();
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
            aria-controls={listboxId}
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
          selected.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-0.5 rounded-sm bg-foreground/10 px-1.5 py-0.5 text-[11px] text-foreground"
            >
              {name}
              <button
                type="button"
                onClick={(clickEvent) => {
                  clickEvent.stopPropagation();
                  removeSecret(name);
                }}
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${name}`}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 gap-0 p-0" align="start" initialFocus={inputRef}>
        <div className="flex items-center gap-1.5 border-b border-border/40 px-2 py-1.5">
          <Search className="size-3 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(changeEvent) => setQuery(changeEvent.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by name or env var…"
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div
          id={listboxId}
          className="max-h-60 overflow-y-auto overscroll-contain p-1"
          role="listbox"
          aria-label="Secrets"
        >
          {filteredOptions.length === 0 ? (
            <p className="px-2 py-2 text-center text-xs text-muted-foreground">
              {query.trim().length > 0 ? "No secrets match your search." : "All secrets selected."}
            </p>
          ) : (
            filteredOptions.map((secret, index) => (
              <button
                key={secret.name}
                type="button"
                role="option"
                aria-selected={index === highlightedIndex}
                onClick={() => addSecret(secret.name)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none transition-colors",
                  index === highlightedIndex
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5",
                )}
              >
                <span className="text-xs">{secret.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground/80">
                  {secret.envVar}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
