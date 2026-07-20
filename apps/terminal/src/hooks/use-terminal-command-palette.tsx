import {
  CalendarClock,
  Coffee,
  FileDiff,
  FolderGit2,
  Key,
  Keyboard,
  MonitorCog,
  Network,
  Plus,
  Search,
  SquareTerminal,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { type CommandItem } from "@/components/command-palette";
import { type CaffeinateMode } from "@/components/keep-awake-menu";
import { TERMINAL_FONT_SIZE_STEP_PX } from "@/lib/constants";
import type { KeyboardShortcutMap } from "@/lib/keyboard-shortcuts";
import {
  TERMINAL_CURSOR_STYLES,
  isTerminalCursorStyle,
  type TerminalCursorStyle,
} from "@/lib/terminal-cursor";
import { TERMINAL_FONTS } from "@/lib/terminal-fonts";
import { TERMINAL_THEMES } from "@/lib/terminal-themes";
import { type CreateWorktreeOptions } from "@/utils/fetch-git-worktrees";
import { formatKeyboardShortcut } from "@/utils/format-keyboard-shortcut";

interface UseTerminalCommandPaletteOptions {
  activeCursorBlink: boolean;
  activeCursorStyle: TerminalCursorStyle;
  activeFontId: string;
  activeFontSize: number;
  activeLocalEcho: boolean;
  activeScrollOnUserInput: boolean;
  activeThemeId: string;
  caffeinateMode: CaffeinateMode;
  caffeinateSupported: boolean;
  createWorktree: (options: CreateWorktreeOptions, openAfter: boolean) => Promise<boolean>;
  handleAutomationsOpenChange: (open: boolean) => void;
  handleCaffeinateModeChange: (mode: CaffeinateMode) => void;
  handleCursorBlinkChange: (enabled: boolean) => void;
  handleCursorStyleChange: (cursorStyle: TerminalCursorStyle) => void;
  handleFontChange: (fontId: string) => void;
  handleFontSizeChange: (fontSize: number) => void;
  handleLocalEchoChange: (enabled: boolean) => void;
  handlePortsOpenChange: (open: boolean) => void;
  handleScrollOnUserInputChange: (enabled: boolean) => void;
  handleSecretsOpenChange: (open: boolean) => void;
  handleSessionsOpenChange: (open: boolean) => void;
  handleThemeChange: (themeId: string) => void;
  handleWorktreesOpenChange: (open: boolean) => void;
  isMac: boolean;
  keyboardShortcuts: KeyboardShortcutMap;
  openDiffViewer: () => void;
  openKeyboardShortcuts: () => void;
  openNewShell: () => void;
  openSearchOverlay: () => void;
  setPreviewCursorStyle: (cursorStyle: TerminalCursorStyle | null) => void;
  setPreviewFontId: (fontId: string | null) => void;
  setPreviewThemeId: (themeId: string | null) => void;
}

interface UseTerminalCommandPaletteResult {
  commandPaletteCommands: CommandItem[];
  handleCommandPaletteHighlight: (item: CommandItem | null) => void;
}

export const useTerminalCommandPalette = ({
  activeCursorBlink,
  activeCursorStyle,
  activeFontId,
  activeFontSize,
  activeLocalEcho,
  activeScrollOnUserInput,
  activeThemeId,
  caffeinateMode,
  caffeinateSupported,
  createWorktree,
  handleAutomationsOpenChange,
  handleCaffeinateModeChange,
  handleCursorBlinkChange,
  handleCursorStyleChange,
  handleFontChange,
  handleFontSizeChange,
  handleLocalEchoChange,
  handlePortsOpenChange,
  handleScrollOnUserInputChange,
  handleSecretsOpenChange,
  handleSessionsOpenChange,
  handleThemeChange,
  handleWorktreesOpenChange,
  isMac,
  keyboardShortcuts,
  openDiffViewer,
  openKeyboardShortcuts,
  openNewShell,
  openSearchOverlay,
  setPreviewCursorStyle,
  setPreviewFontId,
  setPreviewThemeId,
}: UseTerminalCommandPaletteOptions): UseTerminalCommandPaletteResult => {
  const commandPaletteCommands = useMemo<CommandItem[]>(() => {
    return [
      {
        id: "find",
        label: "Find in terminal",
        category: "Actions",
        shortcut: formatKeyboardShortcut(keyboardShortcuts.find, isMac),
        icon: <Search className="size-3.5" />,
        action: openSearchOverlay,
      },
      {
        id: "git-diff",
        label: "View git diff",
        category: "Actions",
        shortcut: formatKeyboardShortcut(keyboardShortcuts.gitDiff, isMac),
        icon: <FileDiff className="size-3.5" />,
        action: openDiffViewer,
      },
      {
        id: "automations",
        label: "Automations",
        category: "Actions",
        shortcut: formatKeyboardShortcut(keyboardShortcuts.automations, isMac),
        icon: <CalendarClock className="size-3.5" />,
        action: () => handleAutomationsOpenChange(true),
      },
      {
        id: "worktrees",
        label: "Git worktrees",
        category: "Actions",
        shortcut: formatKeyboardShortcut(keyboardShortcuts.worktrees, isMac),
        icon: <FolderGit2 className="size-3.5" />,
        action: () => handleWorktreesOpenChange(true),
      },
      {
        id: "sessions",
        label: "Sessions",
        category: "Actions",
        shortcut: formatKeyboardShortcut(keyboardShortcuts.sessions, isMac),
        icon: <SquareTerminal className="size-3.5" />,
        action: () => handleSessionsOpenChange(true),
      },
      {
        id: "ports",
        label: "Dev ports",
        category: "Actions",
        shortcut: formatKeyboardShortcut(keyboardShortcuts.devPorts, isMac),
        icon: <Network className="size-3.5" />,
        action: () => handlePortsOpenChange(true),
      },
      {
        id: "secrets",
        label: "Secrets",
        category: "Actions",
        shortcut: formatKeyboardShortcut(keyboardShortcuts.secrets, isMac),
        icon: <Key className="size-3.5" />,
        action: () => handleSecretsOpenChange(true),
      },
      {
        id: "worktrees-create",
        label: "Create git worktree",
        category: "Actions",
        shortcut: formatKeyboardShortcut(keyboardShortcuts.createWorktree, isMac),
        icon: <Plus className="size-3.5" />,
        action: () => {
          void createWorktree({}, true);
        },
      },
      {
        id: "new-shell",
        label: "Open new shell",
        category: "Actions",
        shortcut: formatKeyboardShortcut(keyboardShortcuts.newShell, isMac),
        icon: <Plus className="size-3.5" />,
        action: openNewShell,
      },
      {
        id: "font-size-up",
        label: "Increase font size",
        category: "Settings",
        shortcut: isMac ? "⌘+" : "Ctrl++",
        icon: <MonitorCog className="size-3.5" />,
        action: () => handleFontSizeChange(activeFontSize + TERMINAL_FONT_SIZE_STEP_PX),
      },
      {
        id: "font-size-down",
        label: "Decrease font size",
        category: "Settings",
        shortcut: isMac ? "⌘-" : "Ctrl+-",
        icon: <MonitorCog className="size-3.5" />,
        action: () => handleFontSizeChange(activeFontSize - TERMINAL_FONT_SIZE_STEP_PX),
      },
      {
        id: "keyboard-shortcuts",
        label: "Keyboard shortcuts",
        category: "Settings",
        icon: <Keyboard className="size-3.5" />,
        action: openKeyboardShortcuts,
      },
      {
        id: "cursor-blink",
        label: "Cursor blink",
        category: "Settings",
        checked: activeCursorBlink,
        action: () => handleCursorBlinkChange(!activeCursorBlink),
      },
      {
        id: "local-echo",
        label: "Predictive typing",
        category: "Settings",
        checked: activeLocalEcho,
        action: () => handleLocalEchoChange(!activeLocalEcho),
      },
      {
        id: "scroll-on-input",
        label: "Pin to bottom on input",
        category: "Settings",
        checked: activeScrollOnUserInput,
        action: () => handleScrollOnUserInputChange(!activeScrollOnUserInput),
      },
      // Keep-awake mode mirrors the coffee dropdown; only offered where
      // caffeinate exists (macOS), matching the toolbar control's gating.
      // Custom automatic commands stay in the popover — they need text input.
      ...(caffeinateSupported
        ? (
            [
              { mode: "off", label: "Keep awake: off" },
              { mode: "on", label: "Keep awake: on" },
              { mode: "automatic", label: "Keep awake: automatic" },
            ] as const
          ).map(({ mode, label }) => ({
            id: `keep-awake:${mode}`,
            label,
            category: "Keep awake",
            icon: <Coffee className="size-3.5" />,
            checked: caffeinateMode === mode,
            action: () => handleCaffeinateModeChange(mode),
          }))
        : []),
      ...TERMINAL_CURSOR_STYLES.map((option) => ({
        id: `cursor:${option.id}`,
        label: option.name,
        category: "Cursor",
        checked: option.id === activeCursorStyle,
        action: () => handleCursorStyleChange(option.id),
      })),
      ...TERMINAL_FONTS.map((font) => ({
        id: `font:${font.id}`,
        label: font.name,
        category: "Font",
        checked: font.id === activeFontId,
        action: () => handleFontChange(font.id),
      })),
      ...TERMINAL_THEMES.map((theme) => ({
        id: `theme:${theme.id}`,
        label: theme.name,
        category: "Theme",
        checked: theme.id === activeThemeId,
        action: () => handleThemeChange(theme.id),
      })),
    ];
  }, [
    activeCursorBlink,
    activeCursorStyle,
    activeFontId,
    activeFontSize,
    activeLocalEcho,
    activeScrollOnUserInput,
    activeThemeId,
    caffeinateMode,
    caffeinateSupported,
    createWorktree,
    handleAutomationsOpenChange,
    handleCaffeinateModeChange,
    handleCursorBlinkChange,
    handleCursorStyleChange,
    handleFontChange,
    handleFontSizeChange,
    handleLocalEchoChange,
    handlePortsOpenChange,
    handleScrollOnUserInputChange,
    handleSecretsOpenChange,
    handleSessionsOpenChange,
    handleThemeChange,
    handleWorktreesOpenChange,
    isMac,
    keyboardShortcuts,
    openDiffViewer,
    openKeyboardShortcuts,
    openNewShell,
    openSearchOverlay,
  ]);

  const handleCommandPaletteHighlight = useCallback(
    (item: CommandItem | null) => {
      const itemId = item?.id ?? "";
      setPreviewThemeId(itemId.startsWith("theme:") ? itemId.slice("theme:".length) : null);
      setPreviewFontId(itemId.startsWith("font:") ? itemId.slice("font:".length) : null);
      const cursorStyleId = itemId.startsWith("cursor:") ? itemId.slice("cursor:".length) : null;
      setPreviewCursorStyle(isTerminalCursorStyle(cursorStyleId) ? cursorStyleId : null);
    },
    [setPreviewCursorStyle, setPreviewFontId, setPreviewThemeId],
  );

  return { commandPaletteCommands, handleCommandPaletteHighlight };
};
