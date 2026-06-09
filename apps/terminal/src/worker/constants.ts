export const SAB_MAGIC = 0x544d5244;
export const SAB_VERSION = 1;

export const SAB_HEADER_INT32S = 16;

export const SAB_HEADER_OFFSET_MAGIC = 0;
export const SAB_HEADER_OFFSET_VERSION = 1;
export const SAB_HEADER_OFFSET_COLS = 2;
export const SAB_HEADER_OFFSET_ROWS = 3;
export const SAB_HEADER_OFFSET_CURSOR_X = 4;
export const SAB_HEADER_OFFSET_CURSOR_Y = 5;
export const SAB_HEADER_OFFSET_CURSOR_VISIBLE = 6;
export const SAB_HEADER_OFFSET_DIRTY_START = 7;
export const SAB_HEADER_OFFSET_DIRTY_END = 8;
export const SAB_HEADER_OFFSET_READY = 9;
export const SAB_HEADER_OFFSET_SCROLL_YBASE = 10;
export const SAB_HEADER_OFFSET_SCROLL_YDISP = 11;
export const SAB_HEADER_OFFSET_SCROLLBACK_LENGTH = 12;
export const SAB_HEADER_OFFSET_ALT_SCREEN_ACTIVE = 13;

export const SAB_CELL_INT32S = 3;
export const SAB_CELLS_OFFSET = SAB_HEADER_INT32S;

export const SAB_READY_WRITING = 0;
export const SAB_READY_SAFE_TO_READ = 1;

export const MAX_SAB_COLS = 1000;
export const MAX_SAB_ROWS = 1000;

export const CONTENT_CODEPOINT_MASK = 0x1fffff;
export const CONTENT_IS_COMBINED_MASK = 0x200000;
export const CONTENT_WIDTH_MASK = 0xc00000;
export const CONTENT_WIDTH_SHIFT = 22;

export const ATTR_CM_MASK = 0x3000000;
export const ATTR_CM_DEFAULT = 0;
export const ATTR_CM_P16 = 0x1000000;
export const ATTR_CM_P256 = 0x2000000;
export const ATTR_CM_RGB = 0x3000000;
export const ATTR_RGB_MASK = 0xffffff;

export const FG_BOLD = 0x8000000;
export const FG_INVERSE = 0x4000000;
export const FG_UNDERLINE = 0x10000000;
export const FG_BLINK = 0x20000000;
export const FG_STRIKETHROUGH = 0x80000000;

export const BG_ITALIC = 0x4000000;
export const BG_DIM = 0x8000000;

export const DEFAULT_ATTR_DATA_FG = 0;
export const DEFAULT_ATTR_DATA_BG = 0;
export const DEFAULT_ATTR_DATA_CONTENT = 1 << CONTENT_WIDTH_SHIFT;
