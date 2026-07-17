import type {
  ChangeEventHandler,
  ComponentProps,
  KeyboardEventHandler,
  MouseEventHandler,
  RefObject,
} from "react";
import type {GitBranchPr, GitDiffSummary} from "@monotykamary/localterm-server/protocol";
import {Binary, ChevronDown, ChevronUp, Command, ImageIcon, Keyboard, Search, X} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import {AutomationsButton} from "@/components/automations-menu";
import {KeepAwakeMenu} from "@/components/keep-awake-menu";
import {PortsButton} from "@/components/ports-menu";
import {QrButton} from "@/components/qr-button";
import {SecretsButton} from "@/components/secrets-menu";
import {SessionsButton} from "@/components/sessions-menu";
import {SettingsMenu} from "@/components/settings-menu";
import {WorktreesButton} from "@/components/worktrees-menu";
import {Button} from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {ON_SCREEN_KEYBOARD_TOGGLE_SELECTOR} from "@/lib/on-screen-keyboard-selectors";
import {
  PR_DISPLAY_STATE_LABELS,
  PR_STATE_STYLES,
  type PrDisplayState,
} from "@/lib/pr-state";
import {cn} from "@/lib/utils";
import type {DeviceTier} from "@/utils/detect-device-tier";
import {formatDiffCount} from "@/utils/format-diff-count";

interface AmbientActionSearchToolbarProps {
  toolbarRef: RefObject<HTMLDivElement | null>;
  display: AmbientToolbarDisplayProps;
  actions: AmbientToolbarActionProps;
  gitMetadata: AmbientToolbarGitMetadataProps;
  search: AmbientToolbarSearchProps;
  settingsMenu: ComponentProps<typeof SettingsMenu>;
  keepAwakeMenu: ComponentProps<typeof KeepAwakeMenu> | null;
}

interface AmbientToolbarDisplayProps {
  deviceTier: DeviceTier;
  isActionsMenuOpen: boolean;
  isOnScreenKeyboardOpen: boolean;
  isSearchOpen: boolean;
  isTouchDevice: boolean;
  isToolbarVisible: boolean;
  shouldEnablePointerEvents: boolean;
  shouldShowAmbientToolbar: boolean;
  shouldShowGitMetadata: boolean;
  shouldShowToolbarHandle: boolean;
}

interface AmbientToolbarActionProps {
  onAutomationsOpen: () => void;
  onCloseOnScreenKeyboard: () => void;
  onCommandPaletteToggle: () => void;
  onMouseEnter: MouseEventHandler<HTMLDivElement>;
  onMouseLeave: MouseEventHandler<HTMLDivElement>;
  onPasteImage: () => void;
  onPortsOpen: () => void;
  onQrOpen: () => void;
  onRefocusTerminal: () => void;
  onSecretsOpen: () => void;
  onSessionsOpen: () => void;
  onToggleActionsMenu: () => void;
  onToggleOnScreenKeyboard: () => void;
  onWorktreesOpen: () => void;
}

interface AmbientToolbarGitMetadataProps {
  branchPr: GitBranchPr | null;
  branchPrDisplayState: PrDisplayState | null;
  BranchPrIcon: LucideIcon | null;
  diffSummary: GitDiffSummary | null;
  hasDiff: boolean;
  hasToolbarIndicator: boolean;
  isMac: boolean;
  onOpenDiffViewer: () => void;
}

interface AmbientToolbarSearchProps {
  inputRef: RefObject<HTMLInputElement | null>;
  matchLabel: string;
  onClose: () => void;
  onFindNext: (query: string) => void;
  onFindPrevious: (query: string) => void;
  onInputChange: ChangeEventHandler<HTMLInputElement>;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onOpen: () => void;
  query: string;
  resultCount: number;
}

export const AmbientActionSearchToolbar = ({
  toolbarRef,
  display,
  actions,
  gitMetadata,
  search,
  settingsMenu,
  keepAwakeMenu,
}: AmbientActionSearchToolbarProps) => {
  const BranchPrIcon = gitMetadata.BranchPrIcon;

  return (
    <div
      className={cn(
        "absolute right-0 top-0 z-10 flex flex-col items-end pr-3 pt-1",
        display.shouldEnablePointerEvents ? "pointer-events-auto" : "pointer-events-none",
      )}
      onMouseEnter={display.isTouchDevice ? undefined : actions.onMouseEnter}
      onMouseLeave={display.isTouchDevice ? undefined : actions.onMouseLeave}
    >
      <div
        aria-hidden="true"
        className={cn(
          "mr-0.5 h-[2px] w-5 rounded-full bg-muted-foreground/25 transition-opacity duration-150",
          display.shouldShowToolbarHandle
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />
      {!display.isSearchOpen && (
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label="terminal actions"
          data-terminal-actions-toolbar
          className={cn(
            "mt-1 flex max-w-[calc(100dvw-1.5rem)] items-center gap-0.5 rounded-md border border-border/60 bg-background/70 p-0.5 text-muted-foreground shadow-xs backdrop-blur-md",
            "transition-[opacity,transform] duration-200 ease-snappy",
            display.isTouchDevice &&
              "touch-pan-x overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            display.shouldShowAmbientToolbar
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-1 opacity-0",
          )}
          // The settings/automations popovers portal their DOM to <body> but
          // their React events still bubble here; only swallow focus for
          // events originating in the toolbar's own DOM subtree, or popover
          // inputs become unfocusable and typing gets yanked to the terminal.
          onMouseDown={(event) => {
            if (event.currentTarget.contains(event.target as Node)) event.preventDefault();
          }}
          onClickCapture={(event) => {
            if (!display.isTouchDevice || !display.isOnScreenKeyboardOpen) return;
            if (
              event.target instanceof Element &&
              event.target.closest(ON_SCREEN_KEYBOARD_TOGGLE_SELECTOR)
            ) {
              return;
            }
            actions.onCloseOnScreenKeyboard();
          }}
          onKeyDown={(event) => {
            if (event.currentTarget.contains(event.target as Node)) {
              actions.onRefocusTerminal();
            }
          }}
        >
          {/* With an indicator (working changes or a PR) showing, the action
              buttons collapse behind the always-visible indicator and expand
              on hover via the 0fr -> 1fr grid-column transition. */}
          <div
            className={cn(
              "grid",
              display.isTouchDevice ? "shrink-0" : "min-w-0",
              (gitMetadata.hasToolbarIndicator || display.isTouchDevice) &&
                "transition-[grid-template-columns] duration-200 ease-snappy",
              display.isTouchDevice
                ? display.isActionsMenuOpen
                  ? "grid-cols-[1fr]"
                  : "grid-cols-[0fr]"
                : gitMetadata.hasToolbarIndicator && !display.isToolbarVisible
                  ? "grid-cols-[0fr]"
                  : "grid-cols-[1fr]",
            )}
          >
            <div
              className={cn(
                "flex min-w-0 items-center gap-0.5 overflow-hidden",
                (gitMetadata.hasToolbarIndicator || display.isTouchDevice) &&
                  "transition-opacity duration-200 ease-snappy",
                display.isTouchDevice
                  ? display.isActionsMenuOpen
                    ? "opacity-100"
                    : "pointer-events-none opacity-0"
                  : gitMetadata.hasToolbarIndicator && !display.isToolbarVisible
                    ? "pointer-events-none opacity-0"
                    : "opacity-100",
              )}
            >
              <SettingsMenu {...settingsMenu} />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={search.onOpen}
                aria-label="find in terminal"
                className="hover:text-foreground"
              >
                <Search />
              </Button>
              {display.deviceTier !== "desktop" ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={actions.onPasteImage}
                  aria-label="paste or pick an image into the terminal"
                  title="Paste or pick an image into the terminal"
                  className="hover:text-foreground"
                >
                  <ImageIcon />
                </Button>
              ) : null}
              {display.isTouchDevice ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={actions.onCommandPaletteToggle}
                  aria-label="command palette"
                  className="hover:text-foreground"
                >
                  <Command />
                </Button>
              ) : null}
              {display.deviceTier !== "desktop" ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-on-screen-keyboard-toggle
                  onClick={actions.onToggleOnScreenKeyboard}
                  aria-label="toggle on-screen keyboard"
                  className={cn(
                    "hover:text-foreground",
                    display.isOnScreenKeyboardOpen && "text-primary",
                  )}
                >
                  <Keyboard />
                </Button>
              ) : null}
              <AutomationsButton onOpen={actions.onAutomationsOpen} isMac={gitMetadata.isMac} />
              <WorktreesButton onOpen={actions.onWorktreesOpen} isMac={gitMetadata.isMac} />
              <SessionsButton onOpen={actions.onSessionsOpen} isMac={gitMetadata.isMac} />
              <PortsButton onOpen={actions.onPortsOpen} />
              <SecretsButton onOpen={actions.onSecretsOpen} />
              {keepAwakeMenu ? <KeepAwakeMenu {...keepAwakeMenu} /> : null}
              <QrButton onOpen={actions.onQrOpen} />
            </div>
          </div>
          {display.isTouchDevice ||
          (display.shouldShowGitMetadata &&
            ((gitMetadata.hasDiff && gitMetadata.diffSummary !== null) ||
              gitMetadata.branchPrDisplayState)) ? (
            <div className="flex shrink-0 items-center">
              {display.shouldShowGitMetadata &&
              gitMetadata.hasDiff &&
              gitMetadata.diffSummary !== null ? (
                <button
                  type="button"
                  onClick={gitMetadata.onOpenDiffViewer}
                  aria-label={`view git diff: ${gitMetadata.diffSummary.additions} additions, ${gitMetadata.diffSummary.deletions} deletions${gitMetadata.diffSummary.binaries > 0 ? `, ${gitMetadata.diffSummary.binaries} binary files changed` : ""}`}
                  title={`${gitMetadata.isMac ? "⌘" : "Ctrl+"}G`}
                  className="flex h-8 items-center gap-1 rounded-[min(var(--radius-md),10px)] px-2 font-mono text-xs tabular-nums outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="text-[var(--localterm-green)]">
                    +{formatDiffCount(gitMetadata.diffSummary.additions)}
                  </span>
                  <span className="text-[var(--localterm-red)]">
                    −{formatDiffCount(gitMetadata.diffSummary.deletions)}
                  </span>
                  {gitMetadata.diffSummary.binaries > 0 ? (
                    <span className="flex items-center gap-0.5 text-muted-foreground">
                      <Binary className="size-3" aria-hidden="true" />
                      {gitMetadata.diffSummary.binaries}
                    </span>
                  ) : null}
                </button>
              ) : null}
              {display.shouldShowGitMetadata &&
              gitMetadata.branchPr &&
              gitMetadata.branchPrDisplayState &&
              BranchPrIcon ? (
                <button
                  type="button"
                  onClick={gitMetadata.onOpenDiffViewer}
                  aria-label={`view pull request diff: PR #${gitMetadata.branchPr.number} (${PR_DISPLAY_STATE_LABELS[gitMetadata.branchPrDisplayState]})${gitMetadata.branchPr.title ? ` — ${gitMetadata.branchPr.title}` : ""}`}
                  title={`PR #${gitMetadata.branchPr.number} (${PR_DISPLAY_STATE_LABELS[gitMetadata.branchPrDisplayState]})${gitMetadata.branchPr.title ? ` — ${gitMetadata.branchPr.title}` : ""}`}
                  className={cn(
                    "flex h-8 items-center gap-1 rounded-[min(var(--radius-md),10px)] px-2 font-mono text-xs tabular-nums outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    PR_STATE_STYLES[gitMetadata.branchPrDisplayState].text,
                  )}
                >
                  <BranchPrIcon className="size-3.5" aria-hidden="true" />
                  <span>#{gitMetadata.branchPr.number}</span>
                </button>
              ) : null}
              {display.isTouchDevice ? (
                <button
                  type="button"
                  data-on-screen-keyboard-actions-toggle
                  onClick={actions.onToggleActionsMenu}
                  aria-label={
                    display.isActionsMenuOpen ? "Hide terminal actions" : "Show terminal actions"
                  }
                  aria-expanded={display.isActionsMenuOpen}
                  className="flex h-8 w-8 items-center justify-center rounded-[min(var(--radius-md),10px)] outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform duration-200 ease-snappy",
                      display.isActionsMenuOpen ? "rotate-180" : "rotate-0",
                    )}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {display.isSearchOpen && (
        <InputGroup
          role="search"
          aria-label="find in terminal"
          className="mt-1 w-80 border-border/60 bg-background/70 text-muted-foreground shadow-xs backdrop-blur-md dark:bg-background/70"
        >
          <InputGroupInput
            ref={search.inputRef}
            type="search"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={search.query}
            onChange={search.onInputChange}
            onKeyDown={search.onKeyDown}
            placeholder="Find"
            aria-label="find query"
            className="text-xs"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText role="status" aria-label="match count" className="text-xs tabular-nums">
              {search.matchLabel}
            </InputGroupText>
            <InputGroupButton
              size="icon-xs"
              onClick={() => search.onFindPrevious(search.query)}
              disabled={search.resultCount === 0}
              aria-label="previous match"
            >
              <ChevronUp />
            </InputGroupButton>
            <InputGroupButton
              size="icon-xs"
              onClick={() => search.onFindNext(search.query)}
              disabled={search.resultCount === 0}
              aria-label="next match"
            >
              <ChevronDown />
            </InputGroupButton>
            <InputGroupButton size="icon-xs" onClick={search.onClose} aria-label="close find">
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )}
    </div>
  );
};
