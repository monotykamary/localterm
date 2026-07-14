import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
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
  type SpecialKey,
} from "./keyboard-layout";
import {
  KEYBOARD_ALTERNATE_FONT_SIZE_PX,
  KEYBOARD_BOTTOM_KEY_HEIGHT_PX,
  KEYBOARD_BOTTOM_PADDING_PX,
  KEYBOARD_FONT_SIZE_PX,
  KEYBOARD_GAP_PX,
  KEYBOARD_HORIZONTAL_PADDING_PX,
  KEYBOARD_KEY_HEIGHT_PX,
  KEYBOARD_KEY_RADIUS_PX,
  KEYBOARD_ROW_GAP_PX,
  KEYBOARD_SLIDE_THRESHOLD_PX,
  KEYBOARD_SPECIAL_FONT_SIZE_PX,
} from "@/lib/constants";

interface OnScreenKeyboardProps {
  readonly onInput: (data: string) => void;
  readonly onClose: () => void;
  readonly onHeightChange: (height: number) => void;
  readonly onSwitchToSystemKeyboard: () => void;
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
  onClose,
  onHeightChange,
  onSwitchToSystemKeyboard,
  deviceTier,
}: OnScreenKeyboardProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gesturesRef = useRef<Map<number, ActiveGesture>>(new Map());
  const modifiersRef = useRef<ModifierState>(INITIAL_MODIFIERS);
  const [gestures, setGestures] = useState<readonly ActiveGesture[]>([]);
  const [modifiers, setModifiers] = useState<ModifierState>(INITIAL_MODIFIERS);
  const charFontSize = deviceTier === "tablet" ? KEYBOARD_FONT_SIZE_PX + 2 : KEYBOARD_FONT_SIZE_PX;

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

  const syncGestures = useCallback(() => {
    setGestures([...gesturesRef.current.values()]);
  }, []);

  const handleSpecialTap = useCallback(
    (cell: SpecialKey) => {
      switch (cell.action) {
        case "dismiss":
          onClose();
          return;
        case "systemKeyboard":
          onSwitchToSystemKeyboard();
          return;
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
    [applyModifiers, onClose, onInput, onSwitchToSystemKeyboard],
  );

  const handlePointerDown = useCallback(
    (cell: KeyboardCell, keyId: string, event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const containerRect = containerRef.current?.getBoundingClientRect();
      const keyRect = event.currentTarget.getBoundingClientRect();
      const rect = {
        left: keyRect.left - (containerRect?.left ?? 0),
        top: keyRect.top - (containerRect?.top ?? 0),
        width: keyRect.width,
        height: keyRect.height,
      };
      gesturesRef.current.set(event.pointerId, {
        pointerId: event.pointerId,
        keyId,
        cell,
        startX: event.clientX,
        startY: event.clientY,
        selected: cell.type === "char" ? cell.center : null,
        rect,
      });
      syncGestures();
    },
    [syncGestures],
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
      syncGestures();
    },
    [syncGestures],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gesturesRef.current.get(event.pointerId);
      gesturesRef.current.delete(event.pointerId);
      syncGestures();
      if (!gesture) return;
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
      onInput(buildCharOutput(selected, current));
      applyModifiers(consumeOneShot(current));
    },
    [applyModifiers, handleSpecialTap, onInput, syncGestures],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      gesturesRef.current.delete(event.pointerId);
      syncGestures();
    },
    [syncGestures],
  );

  const renderCell = (cell: KeyboardCell, keyId: string, rowIndex: number) => {
    const isBottomRow = rowIndex === qwertyLayout.rows.length - 1;
    const height = isBottomRow ? KEYBOARD_BOTTOM_KEY_HEIGHT_PX : KEYBOARD_KEY_HEIGHT_PX;
    const gesture = gestures.find((item) => item.keyId === keyId) ?? null;
    const armed = gesture !== null;
    const isChar = cell.type === "char";
    const centerLabel = cell.type === "char" ? cell.center.label : cell.label;
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
    return (
      <div
        key={keyId}
        role="button"
        aria-label={centerLabel}
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
        {isChar ? (
          <>
            <span className="leading-none">{centerLabel}</span>
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
        ) : (
          <span className="leading-none">{centerLabel}</span>
        )}
      </div>
    );
  };

  if (typeof document === "undefined") return null;
  return createPortal(
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
      <div className="pointer-events-none absolute inset-0 overflow-visible">
        {gestures.map((gesture) => {
          const rect = gesture.rect;
          const calloutWidth = rect.width + 24;
          const calloutHeight = rect.height + 24;
          const left = rect.left + rect.width / 2 - calloutWidth / 2;
          const top = rect.top - calloutHeight - 6;
          const label =
            gesture.cell.type === "char"
              ? (gesture.selected ?? gesture.cell.center).label
              : gesture.cell.label;
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
    </div>,
    document.body,
  );
};
