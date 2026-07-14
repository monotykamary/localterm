import type { AgentSkillInfo } from "@monotykamary/localterm-server/protocol";
import { useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import { useAgentSkills } from "@/utils/fetch-agent-skills";
import { SKILL_INVOCATION_PREFIX, computeSkillToken, type SkillToken } from "@/utils/skill-token";
import { cn } from "@/lib/utils";

interface PromptSkillsAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  cwd: string;
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
  className?: string;
  // When true, the textarea grows to fit its content (up to its CSS max-height)
  // instead of staying a fixed row count — the ChatGPT-style composer behavior.
  autoGrow?: boolean;
}

const SKILL_MENU_LIMIT = 8;

// A slash-command autocomplete for pi skills in the agent prompt. Typing "/"
// (at the start of a line or after whitespace) opens a menu of discoverable
// skills filtered by the text after the slash; arrow keys navigate, Enter or
// Tab inserts "/skill:<name> " at the token. Skills are fetched SWR-style via
// useAgentSkills (per the automation's cwd, so project skills appear too).
export const PromptSkillsAutocomplete = ({
  value,
  onChange,
  cwd,
  placeholder,
  ariaLabel,
  rows,
  className,
  autoGrow,
}: PromptSkillsAutocompleteProps) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeToken, setActiveToken] = useState<SkillToken | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const { skills, loading } = useAgentSkills(cwd);

  const filtered = useMemo(() => {
    const trimmed = activeToken?.query.trim().toLowerCase() ?? "";
    const matches =
      trimmed.length === 0
        ? skills
        : skills.filter((skill) => skill.name.toLowerCase().includes(trimmed));
    return matches.slice(0, SKILL_MENU_LIMIT);
  }, [skills, activeToken]);

  const recomputeToken = () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setActiveToken(null);
      return;
    }
    setActiveToken(computeSkillToken(textarea.value, textarea.selectionStart));
  };

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filtered]);

  // Auto-size to content: reset to `auto` first so scrollHeight measures the
  // intrinsic height (otherwise it never shrinks), then clamp growth to the
  // element's CSS max-height — the browser scrolls once it hits it.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !autoGrow) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value, autoGrow]);

  const insertSkill = (skill: AgentSkillInfo) => {
    const textarea = textareaRef.current;
    if (!textarea || !activeToken) return;
    const insertion = `${SKILL_INVOCATION_PREFIX}${skill.name} `;
    const next = `${value.slice(0, activeToken.slashIndex)}${insertion}${value.slice(activeToken.endIndex)}`;
    onChange(next);
    setActiveToken(null);
    const cursor = value.slice(0, activeToken.slashIndex).length + insertion.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const menuOpen = activeToken !== null;
  const hasItems = filtered.length > 0;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menuOpen || !hasItems) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setActiveToken(null);
      return;
    }
    // Modifier-bearing keys fall through to the textarea so Cmd/Ctrl/Alt/Shift
    // + arrow keeps moving (and selecting) the cursor, and Cmd+Enter can
    // submit, instead of the open menu stealing the key.
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(filtered.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const skill = filtered[highlightedIndex];
      if (skill) insertSkill(skill);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={rows}
        className={className}
        onChange={(event) => {
          onChange(event.target.value);
          requestAnimationFrame(recomputeToken);
        }}
        onSelect={() => requestAnimationFrame(recomputeToken)}
        onKeyDown={handleKeyDown}
        onBlur={() => requestAnimationFrame(() => setActiveToken(null))}
      />
      {menuOpen ? (
        <div
          className="absolute left-0 top-full z-10 mt-1 max-h-60 w-full overflow-y-auto overscroll-contain rounded-md border border-border/50 bg-background p-1 shadow-md"
          role="listbox"
          aria-label="Skills"
        >
          {hasItems ? (
            filtered.map((skill, index) => (
              <button
                key={`${skill.source}:${skill.name}`}
                type="button"
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => insertSkill(skill)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none transition-colors",
                  index === highlightedIndex
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5",
                )}
              >
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="font-mono">
                    {SKILL_INVOCATION_PREFIX}
                    {skill.name}
                  </span>
                  {skill.disabled ? (
                    <span className="rounded-sm bg-foreground/10 px-1 text-[10px] text-muted-foreground">
                      manual
                    </span>
                  ) : null}
                </span>
                <span className="line-clamp-2 text-[10px] text-muted-foreground/80">
                  {skill.description}
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-2 text-center text-xs text-muted-foreground">
              {loading
                ? "Loading skills…"
                : activeToken.query.trim().length > 0
                  ? `No skills match “${activeToken.query.trim()}”.`
                  : "No skills found."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
};
