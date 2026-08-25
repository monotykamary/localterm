import type { IDisposable, Terminal as XtermTerminal } from "@xterm/xterm";

import { KITTY_UNICODE_PLACEHOLDER_LAYER_CLASS } from "@/lib/constants";
import {
  kittyPlaceholderMetadataAt,
  type KittyBufferLine,
} from "@/lib/terminal-runtime/kitty-unicode-placeholder-buffer";
import type {
  KittyStoredImage,
  KittyVirtualPlacement,
} from "@/lib/terminal-runtime/kitty-unicode-placeholder-types";

interface XtermBufferLines {
  get(index: number): KittyBufferLine | undefined;
}

type XtermTerminalInternals = XtermTerminal & {
  _core: {
    buffer: {
      lines: XtermBufferLines;
      ydisp: number;
    };
  };
};

interface ResolvedVirtualImage {
  image: KittyStoredImage;
  placement: KittyVirtualPlacement;
}

interface PlaceholderDrawCall extends ResolvedVirtualImage {
  column: number;
  imageColumn: number;
  imageRow: number;
  row: number;
}

export interface KittyUnicodePlaceholderRendererOptions {
  resolve(imageId: number, placementId: number): ResolvedVirtualImage | undefined;
  terminal: XtermTerminal;
}

export class KittyUnicodePlaceholderRenderer implements IDisposable {
  private canvas: HTMLCanvasElement | undefined;
  private context: CanvasRenderingContext2D | undefined;
  private refreshPending = false;
  private readonly renderDisposable: IDisposable;
  private readonly writeParsedDisposable: IDisposable;

  constructor(private readonly options: KittyUnicodePlaceholderRendererOptions) {
    this.renderDisposable = options.terminal.onRender((range) => this.render(range));
    this.writeParsedDisposable = options.terminal.onWriteParsed(() => {
      if (!this.refreshPending) return;
      this.refreshPending = false;
      options.terminal.refresh(0, options.terminal.rows - 1);
    });
  }

  dispose(): void {
    this.renderDisposable.dispose();
    this.writeParsedDisposable.dispose();
    this.canvas?.remove();
    this.canvas = undefined;
    this.context = undefined;
  }

  refresh(): void {
    this.refreshPending = true;
  }

  private ensureCanvas(): CanvasRenderingContext2D | undefined {
    const terminal = this.options.terminal as XtermTerminalInternals;
    const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    const dimensions = terminal.dimensions;
    if (!screen || !dimensions) return undefined;

    if (!this.canvas || !this.context || this.canvas.parentElement !== screen) {
      this.canvas?.remove();
      const canvas = document.createElement("canvas");
      canvas.classList.add(KITTY_UNICODE_PLACEHOLDER_LAYER_CLASS);
      canvas.style.width = `${dimensions.css.canvas.width}px`;
      canvas.style.height = `${dimensions.css.canvas.height}px`;
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "0";
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) return undefined;
      screen.style.isolation = "isolate";
      screen.append(canvas);
      this.canvas = canvas;
      this.context = context;
    }

    if (
      this.canvas.width !== dimensions.device.canvas.width ||
      this.canvas.height !== dimensions.device.canvas.height
    ) {
      this.canvas.width = dimensions.device.canvas.width;
      this.canvas.height = dimensions.device.canvas.height;
      this.canvas.style.width = `${dimensions.css.canvas.width}px`;
      this.canvas.style.height = `${dimensions.css.canvas.height}px`;
    }
    return this.context;
  }

  private render(range: { end: number; start: number }): void {
    const context = this.ensureCanvas();
    const terminal = this.options.terminal as XtermTerminalInternals;
    const dimensions = terminal.dimensions;
    if (!context || !dimensions) return;

    const cellWidth = dimensions.device.cell.width;
    const cellHeight = dimensions.device.cell.height;
    context.clearRect(
      0,
      range.start * cellHeight,
      dimensions.device.canvas.width,
      (range.end - range.start + 1) * cellHeight,
    );

    const drawCalls: PlaceholderDrawCall[] = [];
    const buffer = terminal._core.buffer;
    for (let row = range.start; row <= range.end; row += 1) {
      const line = buffer.lines.get(buffer.ydisp + row);
      if (!line) continue;
      for (let column = 0; column < terminal.cols; column += 1) {
        const placeholder = kittyPlaceholderMetadataAt(line, column);
        if (!placeholder) continue;
        const resolved = this.options.resolve(placeholder.imageId, placeholder.placementId);
        if (!resolved) continue;
        if (
          placeholder.imageColumn >= resolved.placement.columns ||
          placeholder.imageRow >= resolved.placement.rows
        ) {
          continue;
        }
        drawCalls.push({
          ...resolved,
          column,
          imageColumn: placeholder.imageColumn,
          imageRow: placeholder.imageRow,
          row,
        });
      }
    }

    drawCalls.sort((left, right) => left.placement.zIndex - right.placement.zIndex);
    for (const drawCall of drawCalls) {
      this.drawCell(context, drawCall, cellWidth, cellHeight);
    }
  }

  private drawCell(
    context: CanvasRenderingContext2D,
    call: PlaceholderDrawCall,
    cellWidth: number,
    cellHeight: number,
  ): void {
    const { image, placement } = call;
    const targetWidth = placement.columns * cellWidth;
    const targetHeight = placement.rows * cellHeight;
    const scale = Math.min(targetWidth / image.source.width, targetHeight / image.source.height);
    if (!Number.isFinite(scale) || scale <= 0) return;

    const renderedWidth = image.source.width * scale;
    const renderedHeight = image.source.height * scale;
    const imageLeft = (targetWidth - renderedWidth) / 2;
    const imageTop = (targetHeight - renderedHeight) / 2;
    const cellLeft = call.imageColumn * cellWidth;
    const cellTop = call.imageRow * cellHeight;
    const intersectionLeft = Math.max(cellLeft, imageLeft);
    const intersectionTop = Math.max(cellTop, imageTop);
    const intersectionRight = Math.min(cellLeft + cellWidth, imageLeft + renderedWidth);
    const intersectionBottom = Math.min(cellTop + cellHeight, imageTop + renderedHeight);
    if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) return;

    const sourceX = (intersectionLeft - imageLeft) / scale;
    const sourceY = (intersectionTop - imageTop) / scale;
    const sourceWidth = (intersectionRight - intersectionLeft) / scale;
    const sourceHeight = (intersectionBottom - intersectionTop) / scale;
    const destinationX = call.column * cellWidth + intersectionLeft - cellLeft;
    const destinationY = call.row * cellHeight + intersectionTop - cellTop;
    context.drawImage(
      image.source.source,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      destinationX,
      destinationY,
      intersectionRight - intersectionLeft,
      intersectionBottom - intersectionTop,
    );
  }
}
