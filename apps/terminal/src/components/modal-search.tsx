import { Search } from "lucide-react";
import type { RefObject } from "react";

interface ModalSearchProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}

export const ModalSearch = ({
  inputRef,
  value,
  placeholder,
  ariaLabel,
  onChange,
}: ModalSearchProps) => (
  <div className="relative px-2.5 pt-1 pb-1.5">
    <Search
      className="pointer-events-none absolute left-[14px] top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
    <input
      ref={inputRef}
      type="text"
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full rounded-sm border border-border/50 bg-transparent py-1 pl-6 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-border"
    />
  </div>
);
