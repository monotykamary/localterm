export const RECONNECT_DELAY_MS = 1000;
export const RESIZE_DEBOUNCE_MS = 80;
export const TERMINAL_SCROLLBACK_PURGE_ERASE_DISPLAY_PARAM = 3;
export const DEFAULT_TERMINAL_FONT_SIZE_PX = 13;
export const TERMINAL_FONT_SIZE_MIN_PX = 9;
export const TERMINAL_FONT_SIZE_MAX_PX = 24;
export const TERMINAL_FONT_SIZE_STEP_PX = 1;
export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.2;
// xterm.js refuses lineHeight < 1 (throws "lineHeight cannot be less than 1").
export const TERMINAL_LINE_HEIGHT_MIN = 1.0;
export const TERMINAL_LINE_HEIGHT_MAX = 2.0;
export const TERMINAL_LINE_HEIGHT_STEP = 0.1;
export const DEFAULT_TERMINAL_PADDING_X_PX = 0;
export const DEFAULT_TERMINAL_PADDING_Y_PX = 0;
export const TERMINAL_PADDING_MIN_PX = 0;
export const TERMINAL_PADDING_MAX_PX = 48;
export const TERMINAL_PADDING_STEP_PX = 1;
export const DEFAULT_TERMINAL_CURSOR_BLINK = true;
export const DEFAULT_TERMINAL_SCROLL_ON_USER_INPUT = true;
export const FALLBACK_TERMINAL_BACKGROUND_HEX = "#101010";
export const DEFAULT_DOCUMENT_TITLE = "localterm";
export const DEAD_SESSION_TITLE_PREFIX = "† ";
export const DISCONNECT_MODAL_THRESHOLD_FAILURES = 2;
export const RESTART_COMMAND = "npx @monotykamary/localterm@latest start";
export const COPY_FEEDBACK_MS = 1500;
export const RETRY_BUTTON_FEEDBACK_MS = 800;
export const RECONNECT_FAST_POLL_INTERVAL_MS = 250;
export const RECONNECT_FAST_POLL_DURATION_MS = 5000;
export const RECONNECT_POLL_INTERVAL_MS = 5000;
export const FAVICON_RUNNING_DEBOUNCE_MS = 250;
export const FAVICON_READY_DEBOUNCE_MS = 750;
export const FAVICON_DEAD_OPACITY = 0.35;

export const COMMAND_PALETTE_CLOSE_TRANSITION_MS = 150;

export const DIFF_VIEWER_CLOSE_TRANSITION_MS = 150;
// Render cap per file in the diff viewer. Beyond this the remaining hunks are
// hidden behind a "show all" button so a generated-file diff can't lock up
// the main thread on first paint.
export const DIFF_VIEWER_INITIAL_LINE_LIMIT = 2000;
export const DIFF_VIEW_MODE_STORAGE_KEY = "localterm:diff-view-mode";

export const AUTOMATIONS_RELATIVE_TIME_REFRESH_MS = 30_000;
export const AUTOMATIONS_MODAL_CLOSE_TRANSITION_MS = 150;
// Most-recent runs shown in the cross-automation "Recent runs" feed.
export const RECENT_RUNS_LIMIT = 50;

export const TOOLBAR_HIDE_DELAY_MS = 200;
export const TOOLBAR_VIEWPORT_EDGE_HIDE_DELAY_MS = 1500;
export const TOOLTIP_DELAY_MS = 300;
export const TOOLTIP_SIDE_OFFSET_PX = 8;

export const NUMBER_STEPPER_SCRUB_PIXELS_PER_STEP = 5;

export const ENTER_KEY_CODE = 13;
export const KEYBOARD_MODIFIER_SHIFT_BIT = 1;
export const KEYBOARD_MODIFIER_ALT_BIT = 2;
export const KEYBOARD_MODIFIER_CTRL_BIT = 4;
export const KEYBOARD_MODIFIER_META_BIT = 8;
// Kitty keyboard protocol "Disambiguate escape codes" flag (bit 0). Active means
// modifier+key combos must be reported as `CSI <keycode>;<mods+1> u` instead of
// the legacy bare control byte (which can't distinguish e.g. Enter vs Shift+Enter).
export const KITTY_KEYBOARD_DISAMBIGUATE_FLAG = 1;
export const KITTY_KEYBOARD_SET_MODE_REPLACE = 1;
export const KITTY_KEYBOARD_SET_MODE_OR = 2;
export const KITTY_KEYBOARD_SET_MODE_AND_NOT = 3;

export const SEARCH_MATCH_BACKGROUND_HEX = "#ffc79944";
export const SEARCH_ACTIVE_MATCH_BACKGROUND_HEX = "#ffc799";
export const SEARCH_ACTIVE_MATCH_BORDER_HEX = "#ff8080";

// Coffee button (keep-awake toggle). The icon tints to a warm coffee tone when
// active; otherwise it renders like the other toolbar icons.
export const CAFFEINATE_ACCENT_COLOR = "#c8956c";

export const TERMINAL_THEME_STORAGE_KEY = "localterm:terminal-theme-id";
export const TERMINAL_FONT_STORAGE_KEY = "localterm:terminal-font-id";
export const TERMINAL_FONT_SIZE_STORAGE_KEY = "localterm:terminal-font-size";
export const TERMINAL_LINE_HEIGHT_STORAGE_KEY = "localterm:terminal-line-height";
export const TERMINAL_CURSOR_STYLE_STORAGE_KEY = "localterm:terminal-cursor-style";
export const TERMINAL_CURSOR_BLINK_STORAGE_KEY = "localterm:terminal-cursor-blink";
export const TERMINAL_SCROLLBACK_STORAGE_KEY = "localterm:terminal-scrollback";
export const TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY = "localterm:terminal-scroll-on-user-input";
export const TERMINAL_PADDING_X_STORAGE_KEY = "localterm:terminal-padding-x";
export const TERMINAL_PADDING_Y_STORAGE_KEY = "localterm:terminal-padding-y";
export const GOOGLE_FONTS_STYLESHEET_ID = "localterm-google-fonts";
export const NERD_FONT_ENABLED_STORAGE_KEY = "localterm:nerd-font-enabled";
export const NERD_FONT_SYMBOLS_FAMILY = "Symbols Nerd Font";
export const NERD_FONT_STYLESHEET_ID = "localterm-nerd-font";
export const FONT_LOAD_PROBE_PX = 16;
