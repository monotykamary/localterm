import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronUp, CornerDownLeft, Delete, type LucideIcon } from "lucide-react";
import { KeyboardSettingsModal } from "@/components/on-screen-keyboard/keyboard-settings-modal";
import { useOnScreenKeyboardSettings } from "@/hooks/use-on-screen-keyboard-settings";
import { cn } from "@/lib/utils";
import type { DeviceTier } from "@/utils/detect-device-tier";
import { buildCharOutput, buildSpecialOutput } from "@/utils/build-keyboard-output";
import { computeKeyboardSlideTarget } from "@/utils/compute-keyboard-slide-target";
import {
  ALL_SLIDE_DIRECTIONS,
  qwertyLayout,
  type KeyboardCell,
  type KeyGlyph,
  type ModifierMode,
  type ModifierState,
  type SlideDirection,
  type SpecialAction,
  type SpecialKey,
} from "./keyboard-layout";
import {
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  HAPTIC_TAP_MS,
  KEYBOARD_ALTERNATE_FONT_SIZE_PX,
  KEYBOARD_ALTERNATE_ICON_SIZE_PX,
  KEYBOARD_BOTTOM_KEY_HEIGHT_PX,
  KEYBOARD_BOTTOM_PADDING_PX,
  KEYBOARD_CALLOUT_CHAR_WIDTH_FACTOR,
  KEYBOARD_CALLOUT_FONT_SIZE_PX,
  KEYBOARD_CALLOUT_OFFSET_PX,
  KEYBOARD_CALLOUT_PADDING_PX,
  KEYBOARD_FONT_SIZE_PX,
  KEYBOARD_GAP_PX,
  KEYBOARD_HEIGHT_SCALE_BASE_PERCENT,
  KEYBOARD_HORIZONTAL_PADDING_PX,
  KEYBOARD_ICON_SIZE_PX,
  KEYBOARD_KEY_HEIGHT_PX,
  KEYBOARD_KEY_RADIUS_PX,
  KEYBOARD_KEY_REPEAT_INITIAL_DELAY_MS,
  KEYBOARD_KEY_REPEAT_INTERVAL_MS,
  KEYBOARD_ROW_GAP_PX,
  KEYBOARD_SHIFT_LONG_PRESS_MS,
  KEYBOARD_SLIDE_THRESHOLD_PX,
  KEYBOARD_SPECIAL_FONT_SIZE_PX,
  KEYBOARD_TABLET_FONT_SIZE_ADDITION_PX,
} from "@/lib/constants";

interface OnScreenKeyboardProps {
  readonly onInput: (data: string) => void;
  readonly onHeightChange: (height: number) => void;
  readonly onAttachImage: () => void;
  readonly onDismiss: () => void;
  readonly onRefocus: () => void;
  readonly terminalFontSize: number;
  readonly terminalLineHeight: number;
  readonly onTerminalFontSizeChange: (fontSize: number) => void;
  readonly onTerminalLineHeightChange: (lineHeight: number) => void;
  readonly deviceTier: DeviceTier;
}

interface ActiveGesture {
  readonly pointerId: number;
  readonly keyId: string;
  readonly cell: KeyboardCell;
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly startX: number;
  readonly startY: number;
  readonly selected: KeyGlyph | null;
  readonly activeCell: KeyboardCell;
  readonly activeRect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

interface RepeatState {
  timeout: ReturnType<typeof setTimeout> | undefined;
  interval: ReturnType<typeof setInterval> | undefined;
  fired: boolean;
}

const INITIAL_MODIFIERS: ModifierState = {
  shift: "off",
  control: "off",
  alternate: "off",
  command: "off",
  function: "off",
};

const cycleModifier = (mode: ModifierMode): ModifierMode => {
  if (mode === "off") return "oneShot";
  if (mode === "oneShot") return "locked";
  return "off";
};

const consumeOneShot = (state: ModifierState): ModifierState => ({
  shift: state.shift === "oneShot" ? "off" : state.shift,
  control: state.control === "oneShot" ? "off" : state.control,
  alternate: state.alternate === "oneShot" ? "off" : state.alternate,
  command: state.command === "oneShot" ? "off" : state.command,
  function: state.function === "oneShot" ? "off" : state.function,
});

const SPECIAL_ICONS: Partial<Record<SpecialAction, LucideIcon>> = {
  backspace: Delete,
  enter: CornerDownLeft,
  control: ChevronUp,
};

const MODIFIER_POPUP_LABEL: Partial<Record<SpecialAction, string>> = {
  command: "command",
  function: "fn",
};

const SLIDE_CORNER_STYLE: Record<SlideDirection, CSSProperties> = {
  north: { top: 3, left: "50%", transform: "translateX(-50%)" },
  northEast: { top: 3, right: 4 },
  east: { right: 4, top: "50%", transform: "translateY(-50%)" },
  southEast: { bottom: 3, right: 4 },
  south: { bottom: 3, left: "50%", transform: "translateX(-50%)" },
  southWest: { bottom: 3, left: 4 },
  west: { left: 4, top: "50%", transform: "translateY(-50%)" },
  northWest: { top: 3, left: 4 },
};

const renderAlternateCorners = (
  alternates: Partial<Record<SlideDirection, KeyGlyph>> | undefined,
  gesture: ActiveGesture | null,
  alternateFontSize: number,
  alternateIconSize: number,
) =>
  ALL_SLIDE_DIRECTIONS.map((direction) => {
    const glyph = alternates?.[direction];
    if (glyph == null) return null;
    const isAlternateSelected = gesture?.selected === glyph;
    return (
      <span
        key={direction}
        className={cn(
          "absolute leading-none",
          isAlternateSelected ? "text-accent-foreground font-bold" : "text-muted-foreground",
        )}
        style={{
          ...SLIDE_CORNER_STYLE[direction],
          fontSize: alternateFontSize,
        }}
      >
        {glyph.icon ? <glyph.icon size={alternateIconSize} /> : glyph.label}
      </span>
    );
  });

export const OnScreenKeyboard = ({
  onInput,
  onHeightChange,
  onAttachImage,
  onDismiss,
  onRefocus,
  terminalFontSize,
  terminalLineHeight,
  onTerminalFontSizeChange,
  onTerminalLineHeightChange,
  deviceTier,
}: OnScreenKeyboardProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gesturesRef = useRef<Map<number, ActiveGesture>>(new Map());
  const repeatStateRef = useRef<Map<number, RepeatState>>(new Map());
  const shiftHoldRef = useRef<{
    timeout: ReturnType<typeof setTimeout> | undefined;
    fired: boolean;
  }>({
    timeout: undefined,
    fired: false,
  });
  const modifiersRef = useRef<ModifierState>(INITIAL_MODIFIERS);
  const [gestures, setGestures] = useState<readonly ActiveGesture[]>([]);
  const [modifiers, setModifiers] = useState<ModifierState>(INITIAL_MODIFIERS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const {
    heightScalePercent,
    hapticsEnabled,
    keyPreviewEnabled,
    keyRepeatEnabled,
    handleHeightScaleChange,
    handleHapticsEnabledChange,
    handleKeyPreviewEnabledChange,
    handleKeyRepeatEnabledChange,
    resetKeyboardSettings,
  } = useOnScreenKeyboardSettings();
  const keyboardScale = heightScalePercent / KEYBOARD_HEIGHT_SCALE_BASE_PERCENT;
  const keyboardGap = KEYBOARD_GAP_PX * keyboardScale;
  const keyboardRowGap = KEYBOARD_ROW_GAP_PX * keyboardScale;
  const keyboardHorizontalPadding = KEYBOARD_HORIZONTAL_PADDING_PX * keyboardScale;
  const keyboardBottomPadding = KEYBOARD_BOTTOM_PADDING_PX * keyboardScale;
  const keyboardKeyRadius = KEYBOARD_KEY_RADIUS_PX * keyboardScale;
  const keyboardIconSize = KEYBOARD_ICON_SIZE_PX * keyboardScale;
  const keyboardAlternateFontSize = KEYBOARD_ALTERNATE_FONT_SIZE_PX * keyboardScale;
  const keyboardAlternateIconSize = KEYBOARD_ALTERNATE_ICON_SIZE_PX * keyboardScale;
  const keyboardSpecialFontSize = KEYBOARD_SPECIAL_FONT_SIZE_PX * keyboardScale;
  const keyboardCharacterFontSize =
    (KEYBOARD_FONT_SIZE_PX +
      (deviceTier === "tablet" ? KEYBOARD_TABLET_FONT_SIZE_ADDITION_PX : 0)) *
    keyboardScale;
  const keyboardCalloutFontSize = KEYBOARD_CALLOUT_FONT_SIZE_PX * keyboardScale;
  const keyboardCalloutPadding = KEYBOARD_CALLOUT_PADDING_PX * keyboardScale;
  const keyboardCalloutOffset = KEYBOARD_CALLOUT_OFFSET_PX * keyboardScale;
  const shiftActive = modifiers.shift !== "off";
  const openKeyboardSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeKeyboardSettings = useCallback(() => {
    setIsSettingsOpen(false);
    onRefocus();
  }, [onRefocus]);
  const resetMobileSettings = useCallback(() => {
    resetKeyboardSettings();
    onTerminalFontSizeChange(DEFAULT_TERMINAL_FONT_SIZE_PX);
    onTerminalLineHeightChange(DEFAULT_TERMINAL_LINE_HEIGHT);
  }, [onTerminalFontSizeChange, onTerminalLineHeightChange, resetKeyboardSettings]);

  const keyCellMap = useMemo(() => {
    const map = new Map<string, KeyboardCell>();
    qwertyLayout.rows.forEach((row, rowIndex) =>
      row.cells.forEach((cell, cellIndex) => map.set(rowIndex + "-" + cellIndex, cell)),
    );
    return map;
  }, []);

  const keyHitRef = useRef<
    Map<
      string,
      {
        cell: KeyboardCell;
        rect: { left: number; top: number; width: number; height: number };
      }
    >
  >(new Map());

  const buildKeyHit = useCallback(() => {
    const map = keyHitRef.current;
    map.clear();
    const elements = containerRef.current?.querySelectorAll("[data-key-id]");
    if (!elements) return;
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      const keyId = element.getAttribute("data-key-id");
      if (!keyId) continue;
      const cell = keyCellMap.get(keyId);
      if (!cell) continue;
      const r = element.getBoundingClientRect();
      map.set(keyId, {
        cell,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      });
    }
  }, [keyCellMap]);

  const findNearestKey = useCallback(
    (clientX: number, clientY: number) => {
      type Hit = {
        keyId: string;
        cell: KeyboardCell;
        rect: { left: number; top: number; width: number; height: number };
      };
      let best: Hit | null = null;
      let bestDist = Infinity;
      for (const [keyId, entry] of keyHitRef.current) {
        const expandX = keyboardGap / 2;
        const expandY = keyboardRowGap / 2;
        if (
          clientX < entry.rect.left - expandX ||
          clientX > entry.rect.left + entry.rect.width + expandX ||
          clientY < entry.rect.top - expandY ||
          clientY > entry.rect.top + entry.rect.height + expandY
        )
          continue;
        const cx = entry.rect.left + entry.rect.width / 2;
        const cy = entry.rect.top + entry.rect.height / 2;
        const dist = (clientX - cx) ** 2 + (clientY - cy) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          best = { keyId, cell: entry.cell, rect: entry.rect };
        }
      }
      if (best) return best;
      let fallback: Hit | null = null;
      let fallbackDist = Infinity;
      for (const [keyId, entry] of keyHitRef.current) {
        const cx = entry.rect.left + entry.rect.width / 2;
        const cy = entry.rect.top + entry.rect.height / 2;
        const dist = (clientX - cx) ** 2 + (clientY - cy) ** 2;
        if (dist < fallbackDist) {
          fallbackDist = dist;
          fallback = { keyId, cell: entry.cell, rect: entry.rect };
        }
      }
      return fallback;
    },
    [keyboardGap, keyboardRowGap],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const report = () => onHeightChange(container.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(container);
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [onHeightChange]);

  const applyModifiers = useCallback((next: ModifierState) => {
    modifiersRef.current = next;
    setModifiers(next);
  }, []);

  const vibrate = useCallback(() => {
    if (!hapticsEnabled) return;
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(HAPTIC_TAP_MS);
    }
  }, [hapticsEnabled]);

  const syncGestures = useCallback(() => {
    setGestures([...gesturesRef.current.values()]);
  }, []);

  const fireRepeat = useCallback(
    (pointerId: number) => {
      const gesture = gesturesRef.current.get(pointerId);
      if (!gesture) return;
      if (gesture.cell.type === "char") {
        onInput(buildCharOutput(gesture.selected ?? gesture.cell.center, modifiersRef.current));
      } else {
        onInput(buildSpecialOutput(gesture.cell.action, modifiersRef.current));
      }
    },
    [onInput],
  );

  const clearRepeat = useCallback((pointerId: number) => {
    const state = repeatStateRef.current.get(pointerId);
    if (!state) return;
    if (state.timeout) clearTimeout(state.timeout);
    if (state.interval) clearInterval(state.interval);
    repeatStateRef.current.delete(pointerId);
  }, []);

  const startRepeat = useCallback(
    (pointerId: number) => {
      if (!keyRepeatEnabled) return;
      const state: RepeatState = { timeout: undefined, interval: undefined, fired: false };
      state.timeout = setTimeout(() => {
        state.fired = true;
        vibrate();
        fireRepeat(pointerId);
        state.interval = setInterval(() => fireRepeat(pointerId), KEYBOARD_KEY_REPEAT_INTERVAL_MS);
      }, KEYBOARD_KEY_REPEAT_INITIAL_DELAY_MS);
      repeatStateRef.current.set(pointerId, state);
    },
    [fireRepeat, keyRepeatEnabled, vibrate],
  );

  const handleSpecialTap = useCallback(
    (cell: SpecialKey) => {
      vibrate();
      switch (cell.action) {
        case "shift":
          applyModifiers({
            ...modifiersRef.current,
            shift: modifiersRef.current.shift === "off" ? "oneShot" : "off",
          });
          return;
        case "control":
          applyModifiers({
            ...modifiersRef.current,
            control: cycleModifier(modifiersRef.current.control),
          });
          return;
        case "alternate":
          applyModifiers({
            ...modifiersRef.current,
            alternate: cycleModifier(modifiersRef.current.alternate),
          });
          return;
        case "command":
          applyModifiers({
            ...modifiersRef.current,
            command: cycleModifier(modifiersRef.current.command),
          });
          return;
        case "function":
          applyModifiers({
            ...modifiersRef.current,
            function: cycleModifier(modifiersRef.current.function),
          });
          return;
        case "attach-image":
          onAttachImage();
          return;
        case "keyboard-settings":
          openKeyboardSettings();
          return;
        case "dismiss":
          onDismiss();
          return;
        default: {
          const current = modifiersRef.current;
          onInput(buildSpecialOutput(cell.action, current));
          applyModifiers(consumeOneShot(current));
        }
      }
    },
    [applyModifiers, onAttachImage, onDismiss, onInput, openKeyboardSettings, vibrate],
  );

  const handlePointerDown = useCallback(
    (
      cell: KeyboardCell,
      keyId: string,
      rect: { left: number; top: number; width: number; height: number },
      event: ReactPointerEvent<HTMLDivElement>,
    ) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesturesRef.current.set(event.pointerId, {
        pointerId: event.pointerId,
        keyId,
        cell,
        rect,
        startX: event.clientX,
        startY: event.clientY,
        selected: cell.type === "char" ? cell.center : null,
        activeCell: cell,
        activeRect: rect,
      });
      const isModifierKey =
        cell.type === "special" &&
        (cell.action === "shift" || cell.action === "control" || cell.action === "alternate");
      if (!isModifierKey) startRepeat(event.pointerId);
      if (cell.type === "special" && cell.action === "shift") {
        shiftHoldRef.current.fired = false;
        shiftHoldRef.current.timeout = setTimeout(() => {
          shiftHoldRef.current.fired = true;
          applyModifiers({ ...modifiersRef.current, shift: "locked" });
          vibrate();
        }, KEYBOARD_SHIFT_LONG_PRESS_MS);
      }
      syncGestures();
    },
    [applyModifiers, startRepeat, syncGestures, vibrate],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gesturesRef.current.get(event.pointerId);
      if (!gesture) return;
      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      if (Math.hypot(deltaX, deltaY) < KEYBOARD_SLIDE_THRESHOLD_PX) return;
      if (shiftHoldRef.current.timeout) {
        clearTimeout(shiftHoldRef.current.timeout);
        shiftHoldRef.current = { timeout: undefined, fired: false };
      }
      const pressed = gesture.cell;
      let nextSelected: KeyGlyph | null = gesture.selected;
      let nextActiveCell: KeyboardCell = gesture.activeCell;
      let nextActiveRect = gesture.activeRect;
      let resolved = false;
      if (pressed.type === "char" && pressed.alternates) {
        const target = computeKeyboardSlideTarget(
          deltaX,
          deltaY,
          KEYBOARD_SLIDE_THRESHOLD_PX,
          pressed.alternates,
        );
        if (target) {
          nextSelected = target.glyph;
          nextActiveCell = pressed;
          nextActiveRect = gesture.rect;
          resolved = true;
        }
      }
      if (pressed.type === "special" && pressed.alternates) {
        const target = computeKeyboardSlideTarget(
          deltaX,
          deltaY,
          KEYBOARD_SLIDE_THRESHOLD_PX,
          pressed.alternates,
        );
        if (target) {
          nextSelected = target.glyph;
          nextActiveCell = pressed;
          nextActiveRect = gesture.rect;
          resolved = true;
        }
      }
      if (!resolved) {
        const hit = findNearestKey(event.clientX, event.clientY);
        if (hit && hit.keyId !== gesture.keyId) {
          nextSelected = hit.cell.type === "char" ? hit.cell.center : null;
          nextActiveCell = hit.cell;
          nextActiveRect = hit.rect;
        } else {
          nextSelected = pressed.type === "char" ? pressed.center : null;
          nextActiveCell = pressed;
          nextActiveRect = gesture.rect;
        }
      }
      if (nextSelected === gesture.selected && nextActiveCell === gesture.activeCell) return;
      gesturesRef.current.set(event.pointerId, {
        ...gesture,
        selected: nextSelected,
        activeCell: nextActiveCell,
        activeRect: nextActiveRect,
      });
      clearRepeat(event.pointerId);
      const repeatable = !(
        nextActiveCell.type === "special" &&
        (nextActiveCell.action === "shift" ||
          nextActiveCell.action === "control" ||
          nextActiveCell.action === "alternate")
      );
      if (repeatable) startRepeat(event.pointerId);
      syncGestures();
    },
    [clearRepeat, findNearestKey, startRepeat, syncGestures],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gesturesRef.current.get(event.pointerId);
      const didRepeat = repeatStateRef.current.get(event.pointerId)?.fired ?? false;
      clearRepeat(event.pointerId);
      gesturesRef.current.delete(event.pointerId);
      syncGestures();
      if (!gesture) return;
      if (didRepeat) {
        applyModifiers(consumeOneShot(modifiersRef.current));
        return;
      }
      const moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
      const isTap = moved < KEYBOARD_SLIDE_THRESHOLD_PX;
      const active = gesture.activeCell;
      const isDragCorrect = active !== gesture.cell;
      if (active.type === "special") {
        if (active.action === "shift") {
          if (shiftHoldRef.current.timeout) clearTimeout(shiftHoldRef.current.timeout);
          const shiftHeld = shiftHoldRef.current.fired;
          shiftHoldRef.current = { timeout: undefined, fired: false };
          if (isDragCorrect || (isTap && !shiftHeld)) handleSpecialTap(active);
        } else {
          const selected = gesture.selected;
          if (selected?.action) {
            handleSpecialTap({
              type: "special",
              action: selected.action,
              label: selected.label,
            });
          } else if (isDragCorrect || isTap) {
            handleSpecialTap(active);
          }
        }
        return;
      }
      const current = modifiersRef.current;
      vibrate();
      onInput(buildCharOutput(gesture.selected ?? active.center, current));
      applyModifiers(consumeOneShot(current));
    },
    [applyModifiers, clearRepeat, handleSpecialTap, onInput, syncGestures, vibrate],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      clearRepeat(event.pointerId);
      if (shiftHoldRef.current.timeout) clearTimeout(shiftHoldRef.current.timeout);
      shiftHoldRef.current = { timeout: undefined, fired: false };
      gesturesRef.current.delete(event.pointerId);
      syncGestures();
    },
    [clearRepeat, syncGestures],
  );

  const renderCell = (cell: KeyboardCell, keyId: string, rowIndex: number) => {
    const isBottomRow = rowIndex === qwertyLayout.rows.length - 1;
    const height =
      (isBottomRow ? KEYBOARD_BOTTOM_KEY_HEIGHT_PX : KEYBOARD_KEY_HEIGHT_PX) * keyboardScale;
    const gesture = gestures.find((item) => item.activeCell === cell) ?? null;
    const armed = gesture !== null;
    const centerLabel = cell.type === "char" ? cell.center.label : cell.label;
    const faceLabel =
      cell.type === "char" && shiftActive && /^[a-z]$/.test(centerLabel)
        ? centerLabel.toUpperCase()
        : centerLabel;
    const alternates = cell.type === "char" ? cell.alternates : undefined;
    let modifierActive = false;
    if (cell.type === "special") {
      if (cell.action === "shift") modifierActive = modifiers.shift !== "off";
      else if (cell.action === "control")
        modifierActive = modifiers.control !== "off" || modifiers.function !== "off";
      else if (cell.action === "alternate")
        modifierActive = modifiers.alternate !== "off" || modifiers.command !== "off";
    }
    const grow = cell.grow ?? 1;
    const fontSize = cell.type === "special" ? keyboardSpecialFontSize : keyboardCharacterFontSize;
    const background = armed
      ? "bg-accent text-accent-foreground"
      : modifierActive
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-foreground";
    let content: ReactNode;
    if (cell.type === "char") {
      const Icon = cell.icon;
      content = (
        <>
          {Icon ? (
            <Icon size={keyboardIconSize} />
          ) : (
            <span className="leading-none">{faceLabel}</span>
          )}
          {renderAlternateCorners(
            alternates,
            gesture,
            keyboardAlternateFontSize,
            keyboardAlternateIconSize,
          )}
        </>
      );
    } else {
      const Icon = SPECIAL_ICONS[cell.action];
      const specialAlternates = cell.alternates;
      content = (
        <>
          {cell.symbol ? (
            <span className="leading-none">{cell.symbol}</span>
          ) : Icon ? (
            <Icon size={keyboardIconSize} />
          ) : (
            <span className="leading-none">{faceLabel}</span>
          )}
          {renderAlternateCorners(
            specialAlternates,
            gesture,
            keyboardAlternateFontSize,
            keyboardAlternateIconSize,
          )}
        </>
      );
    }
    return (
      <div
        key={keyId}
        data-key-id={keyId}
        role="img"
        aria-label={faceLabel}
        className={cn(
          background,
          "relative flex select-none items-center justify-center rounded-md transition-colors",
        )}
        style={{
          flexGrow: grow,
          flexBasis: 0,
          height,
          borderRadius: keyboardKeyRadius,
          fontSize,
          touchAction: "none",
        }}
      >
        {content}
      </div>
    );
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div
        ref={containerRef}
        data-on-screen-keyboard
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm"
        style={{
          paddingBottom: "calc(" + keyboardBottomPadding + "px + env(safe-area-inset-bottom))",
          touchAction: "none",
        }}
        onPointerDown={(event) => {
          buildKeyHit();
          const hit = findNearestKey(event.clientX, event.clientY);
          if (hit) handlePointerDown(hit.cell, hit.keyId, hit.rect, event);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div
          className="flex flex-col"
          style={{
            gap: keyboardRowGap,
            padding: keyboardRowGap + "px " + keyboardHorizontalPadding + "px 0",
          }}
        >
          {qwertyLayout.rows.map((row, rowIndex) => (
            <div key={rowIndex} className="flex" style={{ gap: keyboardGap }}>
              {row.cells.map((cell, cellIndex) =>
                renderCell(cell, rowIndex + "-" + cellIndex, rowIndex),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none fixed inset-0 z-50 overflow-visible">
        {keyPreviewEnabled
          ? gestures.map((gesture) => {
              const rect = gesture.activeRect;
              let label: string;
              if (gesture.activeCell.type === "char") {
                const glyph = gesture.selected ?? gesture.activeCell.center;
                label =
                  shiftActive &&
                  gesture.selected === gesture.activeCell.center &&
                  /^[a-z]$/.test(glyph.label)
                    ? glyph.label.toUpperCase()
                    : (glyph.name ?? glyph.label);
              } else if (gesture.activeCell.action === "shift") {
                label = shiftHoldRef.current.fired
                  ? "caps lock"
                  : modifiers.shift === "off"
                    ? "shift"
                    : "off";
              } else if (gesture.selected != null) {
                const alternateAction = gesture.selected.action;
                label = alternateAction
                  ? (MODIFIER_POPUP_LABEL[alternateAction] ?? gesture.selected.label)
                  : gesture.selected.label;
              } else {
                label = gesture.activeCell.label;
              }
              const minLabelWidth =
                Math.ceil(
                  label.length * keyboardCalloutFontSize * KEYBOARD_CALLOUT_CHAR_WIDTH_FACTOR,
                ) + keyboardCalloutPadding;
              const calloutWidth = Math.max(rect.width + keyboardCalloutPadding, minLabelWidth);
              const calloutHeight = rect.height + keyboardCalloutPadding;
              const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
              const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
              const left = Math.max(
                0,
                Math.min(
                  rect.left + rect.width / 2 - calloutWidth / 2,
                  viewportWidth - calloutWidth,
                ),
              );
              const top = Math.max(
                0,
                Math.min(
                  rect.top - calloutHeight - keyboardCalloutOffset,
                  viewportHeight - calloutHeight,
                ),
              );
              return (
                <div
                  key={gesture.pointerId}
                  className="flex items-center justify-center rounded-md border bg-popover text-popover-foreground shadow-lg"
                  style={{
                    position: "absolute",
                    left,
                    top,
                    width: calloutWidth,
                    height: calloutHeight,
                    fontSize: keyboardCalloutFontSize,
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </div>
              );
            })
          : null}
      </div>
      {isSettingsOpen ? (
        <KeyboardSettingsModal
          heightScalePercent={heightScalePercent}
          terminalFontSize={terminalFontSize}
          terminalLineHeight={terminalLineHeight}
          hapticsEnabled={hapticsEnabled}
          keyPreviewEnabled={keyPreviewEnabled}
          keyRepeatEnabled={keyRepeatEnabled}
          onHeightScaleChange={handleHeightScaleChange}
          onTerminalFontSizeChange={onTerminalFontSizeChange}
          onTerminalLineHeightChange={onTerminalLineHeightChange}
          onHapticsEnabledChange={handleHapticsEnabledChange}
          onKeyPreviewEnabledChange={handleKeyPreviewEnabledChange}
          onKeyRepeatEnabledChange={handleKeyRepeatEnabledChange}
          onReset={resetMobileSettings}
          onClose={closeKeyboardSettings}
        />
      ) : null}
    </>,
    document.body,
  );
};
