import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Delete, type LucideIcon } from "lucide-react";
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
  HAPTIC_TAP_MS,
  KEYBOARD_ALTERNATE_FONT_SIZE_PX,
  KEYBOARD_BOTTOM_KEY_HEIGHT_PX,
  KEYBOARD_BOTTOM_PADDING_PX,
  KEYBOARD_FONT_SIZE_PX,
  KEYBOARD_GAP_PX,
  KEYBOARD_HORIZONTAL_PADDING_PX,
  KEYBOARD_ICON_SIZE_PX,
  KEYBOARD_KEY_HEIGHT_PX,
  KEYBOARD_KEY_RADIUS_PX,
  KEYBOARD_KEY_REPEAT_INITIAL_DELAY_MS,
  KEYBOARD_KEY_REPEAT_INTERVAL_MS,
  KEYBOARD_ROW_GAP_PX,
  KEYBOARD_SLIDE_THRESHOLD_PX,
  KEYBOARD_SPECIAL_FONT_SIZE_PX,
} from "@/lib/constants";

interface OnScreenKeyboardProps {
  readonly onInput: (data: string) => void;
  readonly onHeightChange: (height: number) => void;
  readonly deviceTier: DeviceTier;
}

interface ActiveGesture {
  readonly pointerId: number;
  readonly keyId: string;
  readonly cell: KeyboardCell;
  readonly startX: number;
  readonly startY: number;
  readonly selected: KeyGlyph | null;
  readonly rect: {
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

const INITIAL_MODIFIERS: ModifierState = { shift: "off", control: "off", alternate: "off" };

const cycleModifier = (mode: ModifierMode): ModifierMode => {
  if (mode === "off") return "oneShot";
  if (mode === "oneShot") return "locked";
  return "off";
};

const consumeOneShot = (state: ModifierState): ModifierState => ({
  shift: state.shift === "oneShot" ? "off" : state.shift,
  control: state.control === "oneShot" ? "off" : state.control,
  alternate: state.alternate === "oneShot" ? "off" : state.alternate,
});

const SPECIAL_ICONS: Partial<Record<SpecialAction, LucideIcon>> = {
  backspace: Delete,
  enter: CornerDownLeft,
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

export const OnScreenKeyboard = ({
  onInput,
  onHeightChange,
  deviceTier,
}: OnScreenKeyboardProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gesturesRef = useRef<Map<number, ActiveGesture>>(new Map());
  const repeatStateRef = useRef<Map<number, RepeatState>>(new Map());
  const modifiersRef = useRef<ModifierState>(INITIAL_MODIFIERS);
  const [gestures, setGestures] = useState<readonly ActiveGesture[]>([]);
  const [modifiers, setModifiers] = useState<ModifierState>(INITIAL_MODIFIERS);
  const charFontSize = deviceTier === "tablet" ? KEYBOARD_FONT_SIZE_PX + 2 : KEYBOARD_FONT_SIZE_PX;
  const shiftActive = modifiers.shift !== "off";

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
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(HAPTIC_TAP_MS);
    }
  }, []);

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
        onInput(buildSpecialOutput(gesture.cell.action));
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
      const state: RepeatState = { timeout: undefined, interval: undefined, fired: false };
      state.timeout = setTimeout(() => {
        state.fired = true;
        vibrate();
        fireRepeat(pointerId);
        state.interval = setInterval(() => fireRepeat(pointerId), KEYBOARD_KEY_REPEAT_INTERVAL_MS);
      }, KEYBOARD_KEY_REPEAT_INITIAL_DELAY_MS);
      repeatStateRef.current.set(pointerId, state);
    },
    [fireRepeat, vibrate],
  );

  const handleSpecialTap = useCallback(
    (cell: SpecialKey) => {
      vibrate();
      switch (cell.action) {
        case "shift":
          applyModifiers({
            ...modifiersRef.current,
            shift: cycleModifier(modifiersRef.current.shift),
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
        default: {
          const current = modifiersRef.current;
          onInput(buildSpecialOutput(cell.action));
          applyModifiers(consumeOneShot(current));
        }
      }
    },
    [applyModifiers, onInput, vibrate],
  );

  const handlePointerDown = useCallback(
    (cell: KeyboardCell, keyId: string, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const keyRect = event.currentTarget.getBoundingClientRect();
      gesturesRef.current.set(event.pointerId, {
        pointerId: event.pointerId,
        keyId,
        cell,
        startX: event.clientX,
        startY: event.clientY,
        selected: cell.type === "char" ? cell.center : null,
        rect: {
          left: keyRect.left,
          top: keyRect.top,
          width: keyRect.width,
          height: keyRect.height,
        },
      });
      const isModifierKey =
        cell.type === "special" &&
        (cell.action === "shift" || cell.action === "control" || cell.action === "alternate");
      if (!isModifierKey) startRepeat(event.pointerId);
      syncGestures();
    },
    [startRepeat, syncGestures],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gesturesRef.current.get(event.pointerId);
      if (!gesture || gesture.cell.type !== "char") return;
      const alternates = gesture.cell.alternates;
      if (!alternates) return;
      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      const target = computeKeyboardSlideTarget(
        deltaX,
        deltaY,
        KEYBOARD_SLIDE_THRESHOLD_PX,
        alternates,
      );
      const nextSelected = target ? target.glyph : gesture.cell.center;
      if (gesture.selected === nextSelected) return;
      gesturesRef.current.set(event.pointerId, { ...gesture, selected: nextSelected });
      clearRepeat(event.pointerId);
      startRepeat(event.pointerId);
      syncGestures();
    },
    [clearRepeat, startRepeat, syncGestures],
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
      if (gesture.cell.type === "special") {
        if (isTap) handleSpecialTap(gesture.cell);
        return;
      }
      const alternates = gesture.cell.alternates;
      const target = alternates
        ? computeKeyboardSlideTarget(
            event.clientX - gesture.startX,
            event.clientY - gesture.startY,
            KEYBOARD_SLIDE_THRESHOLD_PX,
            alternates,
          )
        : null;
      const selected = target ? target.glyph : gesture.cell.center;
      const current = modifiersRef.current;
      vibrate();
      onInput(buildCharOutput(selected, current));
      applyModifiers(consumeOneShot(current));
    },
    [applyModifiers, clearRepeat, handleSpecialTap, onInput, syncGestures, vibrate],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      clearRepeat(event.pointerId);
      gesturesRef.current.delete(event.pointerId);
      syncGestures();
    },
    [clearRepeat, syncGestures],
  );

  const renderCell = (cell: KeyboardCell, keyId: string, rowIndex: number) => {
    const isBottomRow = rowIndex === qwertyLayout.rows.length - 1;
    const height = isBottomRow ? KEYBOARD_BOTTOM_KEY_HEIGHT_PX : KEYBOARD_KEY_HEIGHT_PX;
    const gesture = gestures.find((item) => item.keyId === keyId) ?? null;
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
      else if (cell.action === "control") modifierActive = modifiers.control !== "off";
      else if (cell.action === "alternate") modifierActive = modifiers.alternate !== "off";
    }
    const grow = cell.grow ?? 1;
    const fontSize = cell.type === "special" ? KEYBOARD_SPECIAL_FONT_SIZE_PX : charFontSize;
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
            <Icon size={KEYBOARD_ICON_SIZE_PX} />
          ) : (
            <span className="leading-none">{faceLabel}</span>
          )}
          {ALL_SLIDE_DIRECTIONS.map((direction) => {
            const glyph = alternates?.[direction];
            if (glyph == null) return null;
            const isAlternateSelected = gesture?.selected === glyph;
            return (
              <span
                key={direction}
                className={cn(
                  "absolute leading-none",
                  isAlternateSelected
                    ? "text-accent-foreground font-bold"
                    : "text-muted-foreground",
                )}
                style={{
                  ...SLIDE_CORNER_STYLE[direction],
                  fontSize: KEYBOARD_ALTERNATE_FONT_SIZE_PX,
                }}
              >
                {glyph.label}
              </span>
            );
          })}
        </>
      );
    } else {
      const Icon = SPECIAL_ICONS[cell.action];
      content = cell.symbol ? (
        <span className="leading-none">{cell.symbol}</span>
      ) : Icon ? (
        <Icon size={KEYBOARD_ICON_SIZE_PX} />
      ) : (
        <span className="leading-none">{faceLabel}</span>
      );
    }
    return (
      <div
        key={keyId}
        role="button"
        aria-label={faceLabel}
        className={cn(
          background,
          "relative flex select-none items-center justify-center rounded-md transition-colors",
        )}
        style={{
          flexGrow: grow,
          flexBasis: 0,
          height,
          borderRadius: KEYBOARD_KEY_RADIUS_PX,
          fontSize,
          touchAction: "none",
        }}
        onPointerDown={(event) => handlePointerDown(cell, keyId, event)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
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
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm"
        style={{
          paddingBottom: "calc(" + KEYBOARD_BOTTOM_PADDING_PX + "px + env(safe-area-inset-bottom))",
        }}
      >
        <div
          className="flex flex-col"
          style={{
            gap: KEYBOARD_ROW_GAP_PX,
            padding: KEYBOARD_ROW_GAP_PX + "px " + KEYBOARD_HORIZONTAL_PADDING_PX + "px 0",
          }}
        >
          {qwertyLayout.rows.map((row, rowIndex) => (
            <div key={rowIndex} className="flex" style={{ gap: KEYBOARD_GAP_PX }}>
              {row.cells.map((cell, cellIndex) =>
                renderCell(cell, rowIndex + "-" + cellIndex, rowIndex),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none fixed inset-0 z-50 overflow-visible">
        {gestures.map((gesture) => {
          const rect = gesture.rect;
          const calloutWidth = rect.width + 24;
          const calloutHeight = rect.height + 24;
          const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
          const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
          const left = Math.max(
            0,
            Math.min(rect.left + rect.width / 2 - calloutWidth / 2, viewportWidth - calloutWidth),
          );
          const top = Math.max(
            0,
            Math.min(rect.top - calloutHeight - 6, viewportHeight - calloutHeight),
          );
          let label: string;
          if (gesture.cell.type === "char") {
            const glyph = gesture.selected ?? gesture.cell.center;
            label =
              shiftActive && gesture.selected === gesture.cell.center && /^[a-z]$/.test(glyph.label)
                ? glyph.label.toUpperCase()
                : (glyph.name ?? glyph.label);
          } else {
            label = gesture.cell.label;
          }
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
                fontSize: 28,
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
};
