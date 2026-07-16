import { TERMINAL_CURSOR_KEYBOARD_TAP_TARGET_PX } from "@/lib/constants";

interface TerminalCursorTapGeometry {
  isCursorVisible: boolean;
  tapClientX: number;
  tapClientY: number;
  screenLeft: number;
  screenTop: number;
  screenWidth: number;
  screenHeight: number;
  columns: number;
  rows: number;
  cursorColumn: number;
  cursorRow: number;
}

export const isTerminalCursorTap = ({
  tapClientX,
  tapClientY,
  screenLeft,
  screenTop,
  screenWidth,
  screenHeight,
  columns,
  rows,
  cursorColumn,
  cursorRow,
  isCursorVisible,
}: TerminalCursorTapGeometry): boolean => {
  if (!isCursorVisible) return false;
  if (screenWidth <= 0 || screenHeight <= 0 || columns <= 0 || rows <= 0) return false;

  const cellWidth = screenWidth / columns;
  const cellHeight = screenHeight / rows;
  const visibleCursorColumn = Math.max(0, Math.min(columns - 1, cursorColumn));
  const visibleCursorRow = Math.max(0, Math.min(rows - 1, cursorRow));
  const cursorCenterX = screenLeft + (visibleCursorColumn + 0.5) * cellWidth;
  const cursorCenterY = screenTop + (visibleCursorRow + 0.5) * cellHeight;
  const targetHalfWidth = Math.max(cellWidth, TERMINAL_CURSOR_KEYBOARD_TAP_TARGET_PX) / 2;
  const targetHalfHeight = Math.max(cellHeight, TERMINAL_CURSOR_KEYBOARD_TAP_TARGET_PX) / 2;

  return (
    Math.abs(tapClientX - cursorCenterX) <= targetHalfWidth &&
    Math.abs(tapClientY - cursorCenterY) <= targetHalfHeight
  );
};
