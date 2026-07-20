import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import { KEYBOARD_SHORTCUTS_MODAL_CLOSE_TRANSITION_MS } from "@/lib/constants";
import {
  KEYBOARD_SHORTCUT_DEFINITIONS,
  type KeyboardShortcut,
  type KeyboardShortcutAction,
  type KeyboardShortcutMap,
} from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/utils";
import { areKeyboardShortcutsEqual } from "@/utils/are-keyboard-shortcuts-equal";
import { formatKeyboardShortcut } from "@/utils/format-keyboard-shortcut";
import { keyboardShortcutFromEvent } from "@/utils/keyboard-shortcut-from-event";

interface KeyboardShortcutsModalProps {
  open: boolean;
  isMac: boolean;
  keyboardShortcuts: KeyboardShortcutMap;
  onChange: (action: KeyboardShortcutAction, shortcut: KeyboardShortcut) => void;
  onClose: () => void;
  onReset: () => void;
}

export const KeyboardShortcutsModal = ({
  open,
  isMac,
  keyboardShortcuts,
  onChange,
  onClose,
  onReset,
}: KeyboardShortcutsModalProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [recordingAction, setRecordingAction] = useState<KeyboardShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    setRecordingAction(null);
    setError(null);
    const timer = window.setTimeout(
      () => setMounted(false),
      KEYBOARD_SHORTCUTS_MODAL_CLOSE_TRANSITION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!mounted || !dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [mounted]);

  useEffect(() => {
    if (open && settled) panelRef.current?.focus();
  }, [open, settled]);

  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (recordingAction) {
          setRecordingAction(null);
          setError(null);
        } else {
          onClose();
        }
        return;
      }
      if (!recordingAction) return;
      event.preventDefault();
      event.stopPropagation();
      const shortcut = keyboardShortcutFromEvent(event);
      if (!shortcut) {
        setError("Use a modifier with a key, or choose a function key.");
        return;
      }
      const conflict = KEYBOARD_SHORTCUT_DEFINITIONS.find(
        (definition) =>
          definition.action !== recordingAction &&
          areKeyboardShortcutsEqual(keyboardShortcuts[definition.action], shortcut),
      );
      if (conflict) {
        setError(
          `${formatKeyboardShortcut(shortcut, isMac)} is already assigned to ${conflict.label}.`,
        );
        return;
      }
      onChange(recordingAction, shortcut);
      setRecordingAction(null);
      setError(null);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isMac, keyboardShortcuts, mounted, onChange, onClose, open, recordingAction]);

  if (!mounted) return null;
  const isVisible = open && settled;

  return (
    <dialog
      ref={dialogRef}
      aria-label="keyboard shortcuts"
      className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/10 backdrop:backdrop-blur-xs"
    >
      <div className="flex h-full items-start justify-center pt-[14vh]">
        <div
          aria-hidden
          data-open={isVisible || undefined}
          data-closed={!isVisible || undefined}
          className={cn(COMMAND_PALETTE_BACKDROP_CLASSES)}
        />
        <div
          ref={panelRef}
          tabIndex={-1}
          data-open={isVisible || undefined}
          data-closed={!isVisible || undefined}
          className={cn(
            "relative z-10 flex w-[560px] max-w-[calc(100vw-2rem)] origin-top flex-col overflow-hidden rounded-xl outline-none",
            MODAL_PANEL_CLASSES,
            COMMAND_PALETTE_PANEL_CLASSES,
          )}
        >
          <header className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium">Keyboard shortcuts</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Select a shortcut, then press the new key combination.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="close keyboard shortcuts"
              onClick={onClose}
            >
              <X />
            </Button>
          </header>
          <div className="max-h-[55dvh] overflow-y-auto p-2">
            {KEYBOARD_SHORTCUT_DEFINITIONS.map((definition) => {
              const isRecording = recordingAction === definition.action;
              return (
                <div
                  key={definition.action}
                  className="flex min-h-11 items-center gap-3 rounded-md px-2.5 py-1.5 hover:bg-foreground/5"
                >
                  <span className="min-w-0 flex-1 text-xs text-foreground">{definition.label}</span>
                  <Button
                    type="button"
                    variant={isRecording ? "secondary" : "outline"}
                    size="sm"
                    className="min-w-28 font-mono text-xs"
                    aria-label={`change ${definition.label} shortcut`}
                    onClick={() => {
                      setRecordingAction(definition.action);
                      setError(null);
                    }}
                  >
                    {isRecording
                      ? "Press keys…"
                      : formatKeyboardShortcut(keyboardShortcuts[definition.action], isMac)}
                  </Button>
                </div>
              );
            })}
          </div>
          <footer className="flex min-h-12 items-center gap-3 border-t border-border/40 px-4 py-2">
            <p role="status" className="min-w-0 flex-1 text-[11px] text-destructive">
              {error}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onReset();
                setRecordingAction(null);
                setError(null);
              }}
            >
              <RotateCcw data-icon="inline-start" />
              Reset defaults
            </Button>
          </footer>
        </div>
      </div>
    </dialog>
  );
};
