import type { Terminal as XtermTerminal } from "@xterm/xterm";

import {
  KITTY_GRAPHICS_IMAGE_ID_HIGH_BYTE_MAX,
  KITTY_IMAGE_ID_HIGH_BYTE_MULTIPLIER,
  KITTY_UNICODE_PLACEHOLDER_CODE_POINT,
  XTERM_BUFFER_BACKGROUND_EXTENDED_MASK,
  XTERM_BUFFER_CELL_BACKGROUND_INDEX,
  XTERM_BUFFER_CELL_CONTENT_INDEX,
  XTERM_BUFFER_CELL_SIZE,
  XTERM_BUFFER_COLOR_MODE_MASK,
  XTERM_BUFFER_CONTENT_CODE_POINT_MASK,
  XTERM_BUFFER_CONTENT_IS_COMBINED_MASK,
  XTERM_BUFFER_COLOR_MODE_PALETTE_16,
  XTERM_BUFFER_COLOR_MODE_PALETTE_256,
  XTERM_BUFFER_COLOR_MODE_RGB,
  XTERM_BUFFER_COLOR_PALETTE_MASK,
  XTERM_BUFFER_COLOR_RGB_MASK,
  XTERM_BUFFER_CONTENT_WIDTH_SHIFT,
  XTERM_BUFFER_SINGLE_CELL_WIDTH,
  XTERM_BUFFER_SPACE_CODE_POINT,
  XTERM_EXTENDED_UNDERLINE_STYLE_MASK,
  XTERM_EXTENDED_UNDERLINE_STYLE_SHIFT,
  XTERM_EXTENDED_VARIANT_OFFSET_MASK,
  XTERM_EXTENDED_VARIANT_OFFSET_SHIFT,
} from "@/lib/constants";
import type { KittyPlaceholderExtendedAttributes } from "@/lib/terminal-runtime/kitty-unicode-placeholder-types";
import { kittyUnicodeDiacriticIndex } from "@/utils/kitty-unicode-diacritic-index";

interface XtermAttributeData {
  bg: number;
  extended: KittyPlaceholderExtendedAttributes;
  fg: number;
}

interface XtermBufferLines {
  get(index: number): KittyBufferLine | undefined;
}

interface XtermBuffer {
  lines: XtermBufferLines;
  x: number;
  y: number;
  ybase: number;
}

interface XtermInputHandler {
  _curAttrData: XtermAttributeData;
  print(data: Uint32Array, start: number, end: number): void;
}

interface XtermTerminalInternals extends XtermTerminal {
  _core: {
    _inputHandler: XtermInputHandler;
    buffer: XtermBuffer;
  };
}

interface KittyPlaceholderMetadata {
  imageColumn: number;
  imageId: number;
  imageRow: number;
  placementId: number;
}

export interface KittyBufferLine {
  _combined: Record<number, string | undefined>;
  _data: Uint32Array;
  _extendedAttrs: Record<number, KittyPlaceholderExtendedAttributes | undefined>;
  _invalidateStringCache(): void;
}

interface PendingPlaceholder {
  column: number;
  diacritics: number[];
  foregroundId: number;
  line: KittyBufferLine;
  placementId: number;
  previous: KittyPlaceholderMetadata | undefined;
}

class PlaceholderExtendedAttributes implements KittyPlaceholderExtendedAttributes {
  private rawExt: number;
  private rawUrlId: number;
  kittyPlaceholder: KittyPlaceholderMetadata | undefined;

  constructor(
    source: KittyPlaceholderExtendedAttributes | undefined,
    kittyPlaceholder: KittyPlaceholderMetadata | undefined,
  ) {
    this.rawExt =
      source instanceof PlaceholderExtendedAttributes ? source.rawExt : (source?.ext ?? 0);
    this.rawUrlId =
      source instanceof PlaceholderExtendedAttributes ? source.rawUrlId : (source?.urlId ?? 0);
    this.kittyPlaceholder = kittyPlaceholder;
  }

  get ext(): number {
    if (this.rawUrlId) {
      return (
        (this.rawExt & ~XTERM_EXTENDED_UNDERLINE_STYLE_MASK) |
        (this.underlineStyle << XTERM_EXTENDED_UNDERLINE_STYLE_SHIFT)
      );
    }
    return this.rawExt;
  }

  set ext(value: number) {
    this.rawExt = value;
  }

  get underlineStyle(): number {
    if (this.rawUrlId) return 5;
    return (
      (this.rawExt & XTERM_EXTENDED_UNDERLINE_STYLE_MASK) >>> XTERM_EXTENDED_UNDERLINE_STYLE_SHIFT
    );
  }

  set underlineStyle(value: number) {
    this.rawExt &= ~XTERM_EXTENDED_UNDERLINE_STYLE_MASK;
    this.rawExt |=
      (value << XTERM_EXTENDED_UNDERLINE_STYLE_SHIFT) & XTERM_EXTENDED_UNDERLINE_STYLE_MASK;
  }

  get underlineColor(): number {
    return this.rawExt & (XTERM_BUFFER_COLOR_MODE_MASK | XTERM_BUFFER_COLOR_RGB_MASK);
  }

  set underlineColor(value: number) {
    this.rawExt &= ~(XTERM_BUFFER_COLOR_MODE_MASK | XTERM_BUFFER_COLOR_RGB_MASK);
    this.rawExt |= value & (XTERM_BUFFER_COLOR_MODE_MASK | XTERM_BUFFER_COLOR_RGB_MASK);
  }

  get underlineVariantOffset(): number {
    const value =
      (this.rawExt & XTERM_EXTENDED_VARIANT_OFFSET_MASK) >> XTERM_EXTENDED_VARIANT_OFFSET_SHIFT;
    return value < 0 ? value ^ ~0x7 : value;
  }

  set underlineVariantOffset(value: number) {
    this.rawExt &= ~XTERM_EXTENDED_VARIANT_OFFSET_MASK;
    this.rawExt |=
      (value << XTERM_EXTENDED_VARIANT_OFFSET_SHIFT) & XTERM_EXTENDED_VARIANT_OFFSET_MASK;
  }

  get urlId(): number {
    return this.rawUrlId;
  }

  set urlId(value: number) {
    this.rawUrlId = value;
  }

  clone(): KittyPlaceholderExtendedAttributes {
    const clone = new PlaceholderExtendedAttributes(this, this.kittyPlaceholder);
    clone.kittyPlaceholder = this.kittyPlaceholder ? { ...this.kittyPlaceholder } : undefined;
    return clone;
  }

  isEmpty(): boolean {
    return !this.kittyPlaceholder && this.underlineStyle === 0 && this.rawUrlId === 0;
  }
}

const colorId = (value: number): number | undefined => {
  if (value < 0) return undefined;
  const mode = value & XTERM_BUFFER_COLOR_MODE_MASK;
  if (mode === XTERM_BUFFER_COLOR_MODE_RGB) return value & XTERM_BUFFER_COLOR_RGB_MASK;
  if (mode === XTERM_BUFFER_COLOR_MODE_PALETTE_16 || mode === XTERM_BUFFER_COLOR_MODE_PALETTE_256) {
    return value & XTERM_BUFFER_COLOR_PALETTE_MASK;
  }
  return undefined;
};

const samePrototype = (
  previous: KittyPlaceholderMetadata | undefined,
  foregroundId: number,
  placementId: number,
): previous is KittyPlaceholderMetadata =>
  previous !== undefined &&
  previous.imageId % KITTY_IMAGE_ID_HIGH_BYTE_MULTIPLIER === foregroundId &&
  previous.placementId === placementId;

const resolvePlaceholderMetadata = ({
  diacritics,
  foregroundId,
  placementId,
  previous,
}: Omit<PendingPlaceholder, "column" | "line">): KittyPlaceholderMetadata | undefined => {
  const explicitRow = diacritics[0];
  const explicitColumn = diacritics[1];
  const explicitHighByte = diacritics[2];
  const matchingPrevious = samePrototype(previous, foregroundId, placementId)
    ? previous
    : undefined;

  let imageRow = explicitRow;
  let imageColumn = explicitColumn;
  let highByte = explicitHighByte;
  if (explicitRow === undefined && matchingPrevious) {
    imageRow = matchingPrevious.imageRow;
    imageColumn = matchingPrevious.imageColumn + 1;
    highByte = Math.floor(matchingPrevious.imageId / KITTY_IMAGE_ID_HIGH_BYTE_MULTIPLIER);
  } else if (
    explicitRow !== undefined &&
    explicitColumn === undefined &&
    matchingPrevious?.imageRow === explicitRow
  ) {
    imageColumn = matchingPrevious.imageColumn + 1;
    highByte = Math.floor(matchingPrevious.imageId / KITTY_IMAGE_ID_HIGH_BYTE_MULTIPLIER);
  } else if (
    explicitRow !== undefined &&
    explicitColumn !== undefined &&
    explicitHighByte === undefined &&
    matchingPrevious?.imageRow === explicitRow &&
    matchingPrevious.imageColumn + 1 === explicitColumn
  ) {
    highByte = Math.floor(matchingPrevious.imageId / KITTY_IMAGE_ID_HIGH_BYTE_MULTIPLIER);
  }

  if (imageRow === undefined || imageColumn === undefined) return undefined;
  highByte ??= 0;
  if (highByte > KITTY_GRAPHICS_IMAGE_ID_HIGH_BYTE_MAX) return undefined;
  return {
    imageId: foregroundId + highByte * KITTY_IMAGE_ID_HIGH_BYTE_MULTIPLIER,
    placementId,
    imageRow,
    imageColumn,
  };
};

const placeholderAt = (
  line: KittyBufferLine | undefined,
  column: number,
): KittyPlaceholderMetadata | undefined => {
  if (
    !line ||
    !(
      line._data[column * XTERM_BUFFER_CELL_SIZE + XTERM_BUFFER_CELL_BACKGROUND_INDEX]! &
      XTERM_BUFFER_BACKGROUND_EXTENDED_MASK
    )
  ) {
    return undefined;
  }
  return line._extendedAttrs[column]?.kittyPlaceholder;
};

const blankPlaceholderCell = (
  pending: PendingPlaceholder,
  metadata: KittyPlaceholderMetadata | undefined,
): void => {
  const { column, line } = pending;
  line._data[column * XTERM_BUFFER_CELL_SIZE + XTERM_BUFFER_CELL_CONTENT_INDEX] =
    XTERM_BUFFER_SPACE_CODE_POINT |
    (XTERM_BUFFER_SINGLE_CELL_WIDTH << XTERM_BUFFER_CONTENT_WIDTH_SHIFT);
  delete line._combined[column];
  if (!metadata) return;
  line._data[column * XTERM_BUFFER_CELL_SIZE + XTERM_BUFFER_CELL_BACKGROUND_INDEX] |=
    XTERM_BUFFER_BACKGROUND_EXTENDED_MASK;
  line._extendedAttrs[column] = new PlaceholderExtendedAttributes(
    line._extendedAttrs[column],
    metadata,
  );
};

const updatePendingPlaceholder = (pending: PendingPlaceholder): void => {
  blankPlaceholderCell(pending, resolvePlaceholderMetadata(pending));
};

export const sanitizeKittyPlaceholderCells = (
  line: KittyBufferLine | undefined,
  startColumn: number,
  endColumn: number,
): boolean => {
  if (!line) return false;
  const columnCount = Math.floor(line._data.length / XTERM_BUFFER_CELL_SIZE);
  const start = Math.max(0, startColumn);
  const end = Math.min(columnCount, endColumn);
  let sanitized = false;
  for (let column = start; column < end; column += 1) {
    const content = line._data[column * XTERM_BUFFER_CELL_SIZE + XTERM_BUFFER_CELL_CONTENT_INDEX]!;
    const codePoint =
      content & XTERM_BUFFER_CONTENT_IS_COMBINED_MASK
        ? line._combined[column]?.codePointAt(0)
        : content & XTERM_BUFFER_CONTENT_CODE_POINT_MASK;
    if (codePoint !== KITTY_UNICODE_PLACEHOLDER_CODE_POINT) continue;
    line._data[column * XTERM_BUFFER_CELL_SIZE + XTERM_BUFFER_CELL_CONTENT_INDEX] =
      XTERM_BUFFER_SPACE_CODE_POINT |
      (XTERM_BUFFER_SINGLE_CELL_WIDTH << XTERM_BUFFER_CONTENT_WIDTH_SHIFT);
    delete line._combined[column];
    sanitized = true;
  }
  if (sanitized) line._invalidateStringCache();
  return sanitized;
};

export const installKittyPlaceholderPrintHandler = (terminal: XtermTerminal): (() => void) => {
  const internals = terminal as XtermTerminalInternals;
  const inputHandler = internals._core._inputHandler;
  const originalPrint = inputHandler.print;
  let pending: PendingPlaceholder | undefined;

  const placeholderPrint = (data: Uint32Array, start: number, end: number): void => {
    let cursor = start;
    if (pending) {
      while (cursor < end && pending.diacritics.length < 3) {
        const index = kittyUnicodeDiacriticIndex(data[cursor]!);
        if (index === undefined) break;
        pending.diacritics.push(index);
        cursor += 1;
        updatePendingPlaceholder(pending);
      }
      if (cursor < end || pending.diacritics.length === 3) pending = undefined;
    }

    while (cursor < end) {
      let placeholder = cursor;
      while (placeholder < end && data[placeholder] !== KITTY_UNICODE_PLACEHOLDER_CODE_POINT) {
        placeholder += 1;
      }
      if (placeholder > cursor) originalPrint.call(inputHandler, data, cursor, placeholder);
      if (placeholder === end) return;

      const foregroundId = colorId(inputHandler._curAttrData.fg);
      const placementId = colorId(inputHandler._curAttrData.extended.underlineColor) ?? 0;
      let after = placeholder + 1;
      const diacritics: number[] = [];
      while (after < end && diacritics.length < 3) {
        const index = kittyUnicodeDiacriticIndex(data[after]!);
        if (index === undefined) break;
        diacritics.push(index);
        after += 1;
      }
      // Coordinate diacritics are protocol metadata only. xterm assigns width to some
      // canonical entries (notably U+0487), so printing them shifts every later tile.
      originalPrint.call(inputHandler, data, placeholder, placeholder + 1);

      const buffer = internals._core.buffer;
      const column = Math.max(0, buffer.x - 1);
      const line = buffer.lines.get(buffer.ybase + buffer.y);
      if (line && foregroundId !== undefined) {
        pending = {
          column,
          diacritics,
          foregroundId,
          line,
          placementId,
          previous: placeholderAt(line, column - 1),
        };
        updatePendingPlaceholder(pending);
      } else if (line) {
        blankPlaceholderCell(
          {
            column,
            diacritics,
            foregroundId: 0,
            line,
            placementId,
            previous: undefined,
          },
          undefined,
        );
        pending = undefined;
      }
      if (after < end || diacritics.length === 3) pending = undefined;
      cursor = after;
    }
  };
  inputHandler.print = placeholderPrint;

  return () => {
    if (inputHandler.print === placeholderPrint) inputHandler.print = originalPrint;
  };
};

export const kittyPlaceholderMetadataAt = placeholderAt;
