import type { IBufferCell, IBufferLine } from "@xterm/headless";

const ESC = "\x1b";
const RESET_SEQUENCE = `${ESC}[0m`;

const BASIC_PALETTE_SIZE = 8;
const BRIGHT_PALETTE_LIMIT = 16;
const COLOR_COMPONENT_MASK = 0xff;
const RED_COMPONENT_SHIFT = 16;
const GREEN_COMPONENT_SHIFT = 8;

const SGR_BOLD = 1;
const SGR_DIM = 2;
const SGR_ITALIC = 3;
const SGR_UNDERLINE = 4;
const SGR_BLINK = 5;
const SGR_INVERSE = 7;
const SGR_INVISIBLE = 8;
const SGR_STRIKETHROUGH = 9;
const SGR_FOREGROUND_BASE = 30;
const SGR_BACKGROUND_BASE = 40;
const SGR_EXTENDED_FOREGROUND = 38;
const SGR_EXTENDED_BACKGROUND = 48;
const SGR_BRIGHT_FOREGROUND_BASE = 90;
const SGR_BRIGHT_BACKGROUND_BASE = 100;
const SGR_OVERLINE = 53;
const SGR_RGB_MODE = 2;
const SGR_PALETTE_MODE = 5;

const appendPaletteColor = (
  parameters: number[],
  color: number,
  standardBase: number,
  brightBase: number,
  extendedCode: number,
): void => {
  if (color < BASIC_PALETTE_SIZE) {
    parameters.push(standardBase + color);
    return;
  }
  if (color < BRIGHT_PALETTE_LIMIT) {
    parameters.push(brightBase + color - BASIC_PALETTE_SIZE);
    return;
  }
  parameters.push(extendedCode, SGR_PALETTE_MODE, color);
};

const appendRgbColor = (parameters: number[], color: number, extendedCode: number): void => {
  parameters.push(
    extendedCode,
    SGR_RGB_MODE,
    (color >> RED_COMPONENT_SHIFT) & COLOR_COMPONENT_MASK,
    (color >> GREEN_COMPONENT_SHIFT) & COLOR_COMPONENT_MASK,
    color & COLOR_COMPONENT_MASK,
  );
};

const styleParameters = (cell: IBufferCell): number[] => {
  const parameters: number[] = [];
  if (cell.isBold()) parameters.push(SGR_BOLD);
  if (cell.isDim()) parameters.push(SGR_DIM);
  if (cell.isItalic()) parameters.push(SGR_ITALIC);
  if (cell.isUnderline()) parameters.push(SGR_UNDERLINE);
  if (cell.isBlink()) parameters.push(SGR_BLINK);
  if (cell.isInverse()) parameters.push(SGR_INVERSE);
  if (cell.isInvisible()) parameters.push(SGR_INVISIBLE);
  if (cell.isStrikethrough()) parameters.push(SGR_STRIKETHROUGH);
  if (cell.isOverline()) parameters.push(SGR_OVERLINE);

  if (cell.isFgPalette()) {
    appendPaletteColor(
      parameters,
      cell.getFgColor(),
      SGR_FOREGROUND_BASE,
      SGR_BRIGHT_FOREGROUND_BASE,
      SGR_EXTENDED_FOREGROUND,
    );
  } else if (cell.isFgRGB()) {
    appendRgbColor(parameters, cell.getFgColor(), SGR_EXTENDED_FOREGROUND);
  }

  if (cell.isBgPalette()) {
    appendPaletteColor(
      parameters,
      cell.getBgColor(),
      SGR_BACKGROUND_BASE,
      SGR_BRIGHT_BACKGROUND_BASE,
      SGR_EXTENDED_BACKGROUND,
    );
  } else if (cell.isBgRGB()) {
    appendRgbColor(parameters, cell.getBgColor(), SGR_EXTENDED_BACKGROUND);
  }

  return parameters;
};

// Convert an already-rendered xterm row into text plus SGR only. Resetting before
// every style run makes each row independently replayable if older rows are evicted.
export const renderBufferLineWithSgr = (line: IBufferLine, cell: IBufferCell): string => {
  const plainText = line.translateToString(true);
  if (!plainText) return "";

  let activeStyle = "";
  let consumedCodeUnits = 0;
  let rendered = "";
  for (let column = 0; column < line.length && consumedCodeUnits < plainText.length; column += 1) {
    const current = line.getCell(column, cell);
    if (!current || current.getWidth() === 0) continue;

    const characters = current.getChars() || " ";
    const parameters = styleParameters(current);
    const style = parameters.join(";");
    if (style !== activeStyle) {
      rendered += style ? `${ESC}[0;${style}m` : RESET_SEQUENCE;
      activeStyle = style;
    }
    rendered += characters;
    consumedCodeUnits += characters.length;
  }

  if (activeStyle) rendered += RESET_SEQUENCE;
  return rendered;
};
