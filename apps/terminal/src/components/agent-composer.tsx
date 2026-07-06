import type { AgentThinkingLevel } from "@/utils/runner-form";
import { Brain, Check, ChevronDown, Cpu, Eraser, Layers } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { ModelSelector } from "@/components/model-selector";
import { PromptSkillsAutocomplete } from "@/components/prompt-skills-autocomplete";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type AgentSessionMode = "fresh" | "thread";

interface AgentComposerProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  cwd: string;
  agentModel: string;
  onAgentModelChange: (value: string) => void;
  agentThinking: AgentThinkingLevel | "";
  onAgentThinkingChange: (value: AgentThinkingLevel | "") => void;
  agentSessionMode: AgentSessionMode;
  onAgentSessionModeChange: (value: AgentSessionMode) => void;
}

interface OptionItem {
  id: string;
  label: ReactNode;
  description?: string;
}

const THINKING_ITEMS: readonly OptionItem[] = [
  { id: "default", label: "Auto", description: "harness default" },
  { id: "off", label: "Off" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
];

const SESSION_ITEMS: readonly OptionItem[] = [
  { id: "fresh", label: "Fresh", description: "Ephemeral — a new session each fire." },
  { id: "thread", label: "Thread", description: "Resumes one session per fire, compacts in place." },
];

const labelFor = (items: readonly OptionItem[], id: string): ReactNode =>
  items.find((item) => item.id === id)?.label ?? id;

const composerChipClasses = (open: boolean): string =>
  cn(
    "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium outline-none transition-colors",
    open
      ? "border-ring/50 bg-foreground/10 text-foreground"
      : "border-border/50 bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground",
  );

interface OptionPopoverProps {
  ariaLabel: string;
  trigger: (open: boolean) => ReactElement;
  items: readonly OptionItem[];
  value: string;
  onChange: (id: string) => void;
  popoverClassName?: string;
}

const OptionPopover = ({
  ariaLabel,
  trigger,
  items,
  value,
  onChange,
  popoverClassName,
}: OptionPopoverProps) => {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(() => Math.max(0, items.findIndex((item) => item.id === value)));
  const listboxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setHighlighted(Math.max(0, items.findIndex((item) => item.id === value)));
  }, [open, items, value]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  // Keyboard nav drives a roving highlight on the listbox itself (options are
  // role=option divs, the ARIA listbox pattern), so focus stays here and Enter
  // applies only the highlighted option — no native button activation to
  // double-apply.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => Math.min(items.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = items[highlighted];
      if (item) choose(item.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const activeId = items[highlighted]?.id;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger nativeButton={false} render={trigger(open)} />
      <PopoverContent align="start" className={cn("p-1", popoverClassName)} initialFocus={listboxRef}>
        <div
          ref={listboxRef}
          tabIndex={-1}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={activeId ? `${ariaLabel}-${activeId}` : undefined}
          onKeyDown={handleKeyDown}
          className="flex flex-col outline-none"
        >
          {items.map((item, index) => {
            const selected = item.id === value;
            const active = index === highlighted;
            return (
              <div
                key={item.id}
                id={`${ariaLabel}-${item.id}`}
                role="option"
                tabIndex={-1}
                aria-selected={selected}
                onClick={() => choose(item.id)}
                onMouseEnter={() => setHighlighted(index)}
                className={cn(
                  "flex cursor-pointer flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none transition-colors",
                  active ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5",
                )}
              >
                <span className="flex items-center gap-1.5 text-xs">
                  {selected ? (
                    <Check className="size-3 shrink-0 text-foreground" aria-hidden="true" />
                  ) : (
                    <span className="size-3 shrink-0" aria-hidden="true" />
                  )}
                  {item.label}
                </span>
                {item.description ? (
                  <span className="pl-[1.125rem] text-[10px] text-muted-foreground/70">{item.description}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const AgentComposer = ({
  prompt,
  onPromptChange,
  cwd,
  agentModel,
  onAgentModelChange,
  agentThinking,
  onAgentThinkingChange,
  agentSessionMode,
  onAgentSessionModeChange,
}: AgentComposerProps) => {
  const thinkingId = agentThinking || "default";
  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-background shadow-sm transition-colors focus-within:border-ring/50 focus-within:shadow-md">
      <PromptSkillsAutocomplete
        value={prompt}
        placeholder="Review the latest commits on origin/main and post an exec briefing."
        ariaLabel="agent prompt"
        autoGrow
        cwd={cwd}
        className="max-h-64 min-h-24 w-full resize-none rounded-xl border-0 bg-transparent px-3 pt-2.5 pb-2 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
        onChange={onPromptChange}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2 pt-1.5">
        <ModelSelector
          value={agentModel}
          onChange={onAgentModelChange}
          trigger={(open, value, label) => (
            <button
              type="button"
              aria-label="model"
              aria-haspopup="listbox"
              aria-expanded={open}
              className={composerChipClasses(open)}
            >
              <Cpu className="size-3 shrink-0" aria-hidden="true" />
              <span className="max-w-[10rem] truncate">{value.length === 0 ? "Default" : label}</span>
              <ChevronDown className="size-3 shrink-0 opacity-50" aria-hidden="true" />
            </button>
          )}
        />
        <OptionPopover
          ariaLabel="effort"
          items={THINKING_ITEMS}
          value={thinkingId}
          onChange={(id) => onAgentThinkingChange(id === "default" ? "" : (id as AgentThinkingLevel))}
          popoverClassName="w-52"
          trigger={(open) => (
            <button
              type="button"
              aria-label="effort"
              aria-haspopup="listbox"
              aria-expanded={open}
              className={composerChipClasses(open)}
            >
              <Brain className="size-3 shrink-0" aria-hidden="true" />
              <span>{labelFor(THINKING_ITEMS, thinkingId)}</span>
              <ChevronDown className="size-3 shrink-0 opacity-50" aria-hidden="true" />
            </button>
          )}
        />
        <OptionPopover
          ariaLabel="session"
          items={SESSION_ITEMS}
          value={agentSessionMode}
          onChange={(id) => onAgentSessionModeChange(id as AgentSessionMode)}
          popoverClassName="w-64"
          trigger={(open) => (
            <button
              type="button"
              aria-label="session"
              aria-haspopup="listbox"
              aria-expanded={open}
              className={composerChipClasses(open)}
            >
              <Layers className="size-3 shrink-0" aria-hidden="true" />
              <span>{labelFor(SESSION_ITEMS, agentSessionMode)}</span>
              <ChevronDown className="size-3 shrink-0 opacity-50" aria-hidden="true" />
            </button>
          )}
        />
        {prompt.length > 0 ? (
          <button
            type="button"
            onClick={() => onPromptChange("")}
            aria-label="clear prompt"
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <Eraser className="size-3" aria-hidden="true" />
            Clear
          </button>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 px-1 text-[10px] text-muted-foreground/50">
            <span className="font-mono">/</span> for skills
          </span>
        )}
      </div>
    </div>
  );
};
