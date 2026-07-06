import type { AgentModelInfo } from "@monotykamary/localterm-server/protocol";
import { Search } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAgentModels } from "@/utils/fetch-agent-models";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  placeholder?: string;
  // Optional custom trigger. When omitted, the default full-width combobox is
  // rendered; when provided (e.g. a composer pill), it receives the open state,
  // the current value, and a friendly display label (the model's name when the
  // value matches a known model, else the raw value) so the trigger can show
  // something prettier than `provider/id`.
  trigger?: (open: boolean, value: string, label: string) => ReactElement;
}

const modelId = (model: AgentModelInfo): string =>
  model.provider.length > 0 ? `${model.provider}/${model.id}` : model.id;

// A single-select model picker that mirrors the SecretSelector: a combobox
// trigger + a searchable popover list with arrow-key navigation. The list
// comes from GET /api/agent-models (pi's available models). A leading "Default"
// option clears the selection; Enter on a non-matching query accepts it as a
// custom model string (pi's --model accepts patterns/aliases not in the list).
export const ModelSelector = ({
  value,
  onChange,
  placeholder = "default",
  trigger,
}: ModelSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const { models, loading } = useAgentModels();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0) return models;
    return models.filter((model) => {
      const id = modelId(model).toLowerCase();
      return id.includes(trimmed) || model.name.toLowerCase().includes(trimmed);
    });
  }, [models, query]);

  // A human-readable label for the current value: the matched model's name, or
  // the raw value when it's a custom string not in the list (pi accepts those).
  const displayLabel = useMemo(() => {
    if (value.length === 0) return "";
    const matched = models.find((model) => modelId(model) === value);
    return matched ? matched.name : value;
  }, [models, value]);

  // The option list is [Default, ...filtered]. The Default option is index 0.
  const optionCount = filtered.length + 1;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, filtered.length]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlightedIndex(0);
    }
  }, [open]);

  const choose = (model: string) => {
    onChange(model);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(optionCount - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (highlightedIndex === 0) {
        choose("");
        return;
      }
      const model = filtered[highlightedIndex - 1];
      if (model !== undefined) choose(modelId(model));
      else if (query.trim().length > 0) choose(query.trim());
      return;
    }
    if (event.key === "Backspace" && query.length === 0 && value.length > 0) {
      choose("");
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const defaultTrigger = (
    <div
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      tabIndex={0}
      className={cn(
        "flex h-7 w-full items-center rounded-sm border border-border/50 bg-background px-1.5 text-left text-xs outline-none transition-colors hover:border-border focus-visible:border-ring",
        open && "border-ring",
      )}
    >
      <span className={cn("truncate", value.length === 0 ? "text-muted-foreground/70" : "text-foreground")}>
        {value.length === 0 ? placeholder : value}
      </span>
    </div>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger nativeButton={false} render={trigger ? trigger(open, value, displayLabel) : defaultTrigger} />
      <PopoverContent className="w-80 p-0" align="start" initialFocus={inputRef}>
        <div className="flex items-center gap-1.5 border-b border-border/40 px-2 py-1.5">
          <Search className="size-3 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(changeEvent) => setQuery(changeEvent.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by model or provider…"
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div
          className="max-h-60 overflow-y-auto overscroll-contain p-1"
          role="listbox"
          aria-label="Models"
        >
          <button
            type="button"
            role="option"
            aria-selected={highlightedIndex === 0}
            onClick={() => choose("")}
            onMouseEnter={() => setHighlightedIndex(0)}
            className={cn(
              "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs outline-none transition-colors",
              highlightedIndex === 0
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5",
            )}
          >
            <span>Default</span>
            <span className="text-[10px] text-muted-foreground/60">harness default</span>
          </button>
          {filtered.length === 0 ? (
            query.trim().length > 0 ? (
              <button
                type="button"
                role="option"
                aria-selected={highlightedIndex === 1}
                onClick={() => choose(query.trim())}
                onMouseEnter={() => setHighlightedIndex(1)}
                className={cn(
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs outline-none transition-colors",
                  highlightedIndex === 1
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5",
                )}
              >
                Use “{query.trim()}”
              </button>
            ) : (
              <p className="px-2 py-2 text-center text-xs text-muted-foreground">
                {loading ? "Loading models…" : "No models match your search."}
              </p>
            )
          ) : (
            filtered.map((model, index) => {
              const optionIndex = index + 1;
              return (
                <button
                  key={modelId(model)}
                  type="button"
                  role="option"
                  aria-selected={optionIndex === highlightedIndex}
                  onClick={() => choose(modelId(model))}
                  onMouseEnter={() => setHighlightedIndex(optionIndex)}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none transition-colors",
                    optionIndex === highlightedIndex
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5",
                  )}
                >
                  <span className="text-xs">{modelId(model)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/80">
                    {model.name}
                    {typeof model.contextWindow === "number"
                      ? ` · ${Math.round(model.contextWindow / 1000)}K ctx`
                      : ""}
                    {model.reasoning ? " · thinking" : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
