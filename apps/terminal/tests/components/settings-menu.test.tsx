import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SettingsMenu } from "../../src/components/settings-menu";
import type { TerminalSessionInfo } from "../../src/lib/terminal-session-info";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import {
  DEFAULT_TERMINAL_CURSOR_BLINK,
  DEFAULT_TERMINAL_LOCAL_ECHO,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  DEFAULT_TERMINAL_SCROLL_ON_USER_INPUT,
  TERMINAL_FONT_SIZE_MAX_PX,
  TERMINAL_FONT_SIZE_MIN_PX,
  TERMINAL_FONT_SIZE_STEP_PX,
  TERMINAL_LINE_HEIGHT_STEP,
} from "../../src/lib/constants";
import {
  DEFAULT_TERMINAL_CURSOR_STYLE,
  type TerminalCursorStyle,
} from "../../src/lib/terminal-cursor";
import { DEFAULT_TERMINAL_SCROLLBACK_LINES } from "../../src/lib/terminal-scrollback";

interface SettingsMenuHarnessProps {
  initialFontSize?: number;
  initialLineHeight?: number;
  initialCursorStyle?: TerminalCursorStyle;
  initialCursorBlink?: boolean;
  initialLocalEcho?: boolean;
  initialScrollback?: number;
  initialScrollOnUserInput?: boolean;
  initialThemeId?: string;
  initialFontId?: string;
  initialLigaturesEnabled?: boolean;
  initialDefaultCwd?: string;
  onThemeChange?: (id: string) => void;
  onThemePreview?: (id: string | null) => void;
  onFontChange?: (id: string) => void;
  onFontPreview?: (id: string | null) => void;
  onFontSizeChange?: (size: number) => void;
  onLineHeightChange?: (lineHeight: number) => void;
  onCursorStyleChange?: (style: TerminalCursorStyle) => void;
  onCursorStylePreview?: (style: TerminalCursorStyle | null) => void;
  onCursorBlinkChange?: (blink: boolean) => void;
  onLocalEchoChange?: (enabled: boolean) => void;
  onScrollbackChange?: (scrollback: number) => void;
  onScrollOnUserInputChange?: (scrollOnUserInput: boolean) => void;
  initialCdpPort?: number | null;
  cdpStatus?: { connected: boolean; browser?: string; error?: string } | null;
  cdpConnecting?: boolean;
  onCdpPortChange?: (port: number | null) => void;
  onCdpConnect?: () => void;
  onPaddingXChange?: (paddingX: number) => void;
  onPaddingYChange?: (paddingY: number) => void;
  onLigaturesEnabledChange?: (enabled: boolean) => void;
  onDefaultCwdChange?: (cwd: string) => void;
  notificationsPermission?: NotificationPermission | "unsupported";
  onNotificationsPermissionRequest?: () => void;
  sessionInfo?: TerminalSessionInfo | null;
}

const renderSettingsMenu = ({
  initialFontSize = 13,
  initialLineHeight = DEFAULT_TERMINAL_LINE_HEIGHT,
  initialCursorStyle = DEFAULT_TERMINAL_CURSOR_STYLE,
  initialCursorBlink = DEFAULT_TERMINAL_CURSOR_BLINK,
  initialLocalEcho = DEFAULT_TERMINAL_LOCAL_ECHO,
  initialScrollback = DEFAULT_TERMINAL_SCROLLBACK_LINES,
  initialScrollOnUserInput = DEFAULT_TERMINAL_SCROLL_ON_USER_INPUT,
  initialThemeId = "vesper",
  initialFontId = "geist-mono",
  initialLigaturesEnabled = false,
  initialDefaultCwd = "",
  onThemeChange = () => {},
  onThemePreview,
  onFontChange = () => {},
  onFontPreview,
  onFontSizeChange = () => {},
  onLineHeightChange = () => {},
  onCursorStyleChange = () => {},
  onCursorStylePreview,
  onCursorBlinkChange = () => {},
  onLocalEchoChange = () => {},
  onScrollbackChange = () => {},
  onScrollOnUserInputChange = () => {},
  initialCdpPort = null,
  cdpStatus = null,
  cdpConnecting = false,
  onCdpPortChange = () => {},
  onCdpConnect = () => {},
  onPaddingXChange = () => {},
  onPaddingYChange = () => {},
  onLigaturesEnabledChange = () => {},
  onDefaultCwdChange = () => {},
  notificationsPermission = "default",
  onNotificationsPermissionRequest = () => {},
  sessionInfo,
}: SettingsMenuHarnessProps = {}) =>
  render(
    <TooltipProvider delay={0}>
      <SettingsMenu
        themeId={initialThemeId}
        onThemeChange={onThemeChange}
        onThemePreview={onThemePreview}
        fontId={initialFontId}
        onFontChange={onFontChange}
        onFontPreview={onFontPreview}
        nerdFontEnabled={false}
        onNerdFontEnabledChange={() => {}}
        ligaturesEnabled={initialLigaturesEnabled}
        onLigaturesEnabledChange={onLigaturesEnabledChange}
        fontSize={initialFontSize}
        onFontSizeChange={onFontSizeChange}
        lineHeight={initialLineHeight}
        onLineHeightChange={onLineHeightChange}
        cursorStyle={initialCursorStyle}
        onCursorStyleChange={onCursorStyleChange}
        onCursorStylePreview={onCursorStylePreview}
        cursorBlink={initialCursorBlink}
        onCursorBlinkChange={onCursorBlinkChange}
        localEcho={initialLocalEcho}
        onLocalEchoChange={onLocalEchoChange}
        scrollback={initialScrollback}
        onScrollbackChange={onScrollbackChange}
        scrollOnUserInput={initialScrollOnUserInput}
        onScrollOnUserInputChange={onScrollOnUserInputChange}
        cdpPort={initialCdpPort}
        cdpStatus={cdpStatus}
        cdpConnecting={cdpConnecting}
        onCdpPortChange={onCdpPortChange}
        onCdpConnect={onCdpConnect}
        paddingX={0}
        onPaddingXChange={onPaddingXChange}
        paddingY={0}
        onPaddingYChange={onPaddingYChange}
        defaultCwd={initialDefaultCwd}
        onDefaultCwdChange={onDefaultCwdChange}
        notificationsPermission={notificationsPermission}
        onNotificationsPermissionRequest={onNotificationsPermissionRequest}
        sessionInfo={sessionInfo}
      />
    </TooltipProvider>,
  );

afterEach(() => {
  cleanup();
});

describe("SettingsMenu trigger", () => {
  it("renders a labelled gear button", () => {
    renderSettingsMenu();
    expect(screen.getByLabelText("terminal settings")).toBeDefined();
  });
});

describe("SettingsSelect trigger label", () => {
  // Regression guard: Base UI's <SelectValue> renders the raw value (the id) when
  // it can't resolve a label. Our SettingsSelect explicitly looks up the active
  // item and renders its `label`, so the trigger button shows "Vesper" instead of
  // "vesper", "Geist Mono" instead of "geist-mono", etc. If anyone refactors away
  // the active-item lookup or Base UI changes its children semantics, this catches it.

  it("Theme trigger shows the formatted label, not the raw id", () => {
    renderSettingsMenu({ initialThemeId: "vesper" });
    fireEvent.click(screen.getByLabelText("terminal settings"));
    const trigger = screen.getByLabelText("select theme");
    expect(trigger.textContent).toContain("Vesper");
    expect(trigger.textContent).not.toContain("vesper");
  });

  it("Font trigger shows the formatted label, not the raw id", () => {
    renderSettingsMenu({ initialFontId: "geist-mono" });
    fireEvent.click(screen.getByLabelText("terminal settings"));
    const trigger = screen.getByLabelText("select font");
    expect(trigger.textContent).toContain("Geist Mono");
    expect(trigger.textContent).not.toContain("geist-mono");
  });

  it("Cursor style trigger shows the formatted label, not the raw id", () => {
    renderSettingsMenu({ initialCursorStyle: "block" });
    fireEvent.click(screen.getByLabelText("terminal settings"));
    const trigger = screen.getByLabelText("select cursor style");
    expect(trigger.textContent).toContain("Block");
    expect(trigger.textContent).not.toContain("block");
  });

  it("Scrollback trigger shows a formatted label, not just the raw number string", () => {
    renderSettingsMenu({ initialScrollback: 10000 });
    fireEvent.click(screen.getByLabelText("terminal settings"));
    const trigger = screen.getByLabelText("select scrollback");
    // Scrollback labels include digit grouping or units (e.g. "10,000 lines"),
    // so the rendered text differs from the raw "10000".
    expect(trigger.textContent ?? "").not.toBe("10000");
    expect((trigger.textContent ?? "").length).toBeGreaterThan(0);
  });
});

describe("SettingsMenu font size stepper", () => {
  it("calls onFontSizeChange with the next step when the increment button is clicked", () => {
    const onFontSizeChange = vi.fn();
    renderSettingsMenu({ initialFontSize: 13, onFontSizeChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("increase font size"));

    expect(onFontSizeChange).toHaveBeenCalledWith(13 + TERMINAL_FONT_SIZE_STEP_PX);
  });

  it("calls onFontSizeChange with the previous step when the decrement button is clicked", () => {
    const onFontSizeChange = vi.fn();
    renderSettingsMenu({ initialFontSize: 13, onFontSizeChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("decrease font size"));

    expect(onFontSizeChange).toHaveBeenCalledWith(13 - TERMINAL_FONT_SIZE_STEP_PX);
  });

  it("disables the decrement button at the minimum size", () => {
    renderSettingsMenu({ initialFontSize: TERMINAL_FONT_SIZE_MIN_PX });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    const decrementButton = screen.getByLabelText("decrease font size") as HTMLButtonElement;

    expect(decrementButton.disabled).toBe(true);
  });

  it("disables the increment button at the maximum size", () => {
    renderSettingsMenu({ initialFontSize: TERMINAL_FONT_SIZE_MAX_PX });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    const incrementButton = screen.getByLabelText("increase font size") as HTMLButtonElement;

    expect(incrementButton.disabled).toBe(true);
  });

  it("displays the current font size in the live region", () => {
    renderSettingsMenu({ initialFontSize: 18 });

    fireEvent.click(screen.getByLabelText("terminal settings"));

    expect(screen.getByText("18")).toBeDefined();
  });
});

describe("SettingsMenu line height stepper", () => {
  it("calls onLineHeightChange with the next step when the increment button is clicked", () => {
    const onLineHeightChange = vi.fn();
    renderSettingsMenu({ initialLineHeight: 1.2, onLineHeightChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("increase line height"));

    expect(onLineHeightChange).toHaveBeenCalledTimes(1);
    expect(onLineHeightChange.mock.calls[0]?.[0]).toBeCloseTo(1.2 + TERMINAL_LINE_HEIGHT_STEP, 5);
  });

  it("calls onLineHeightChange with the previous step when the decrement button is clicked", () => {
    const onLineHeightChange = vi.fn();
    renderSettingsMenu({ initialLineHeight: 1.2, onLineHeightChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("decrease line height"));

    expect(onLineHeightChange).toHaveBeenCalledTimes(1);
    expect(onLineHeightChange.mock.calls[0]?.[0]).toBeCloseTo(1.2 - TERMINAL_LINE_HEIGHT_STEP, 5);
  });

  it("formats the line height with a single fractional digit in the live region", () => {
    renderSettingsMenu({ initialLineHeight: 1.2 });

    fireEvent.click(screen.getByLabelText("terminal settings"));

    expect(screen.getByText("1.2")).toBeDefined();
  });
});

describe("SettingsMenu cursor blink switch", () => {
  it("calls onCursorBlinkChange with the toggled value", () => {
    const onCursorBlinkChange = vi.fn();
    renderSettingsMenu({ initialCursorBlink: true, onCursorBlinkChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("toggle cursor blink"));

    expect(onCursorBlinkChange).toHaveBeenCalledTimes(1);
    expect(onCursorBlinkChange.mock.calls[0]?.[0]).toBe(false);
  });
});

describe("SettingsMenu predictive typing switch", () => {
  it("calls onLocalEchoChange with the toggled value", () => {
    const onLocalEchoChange = vi.fn();
    renderSettingsMenu({ initialLocalEcho: false, onLocalEchoChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("toggle predictive typing"));

    expect(onLocalEchoChange).toHaveBeenCalledTimes(1);
    expect(onLocalEchoChange.mock.calls[0]?.[0]).toBe(true);
  });
});

describe("SettingsMenu ligatures switch", () => {
  it("calls onLigaturesEnabledChange with the toggled value", () => {
    const onLigaturesEnabledChange = vi.fn();
    renderSettingsMenu({ initialLigaturesEnabled: false, onLigaturesEnabledChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("toggle ligatures"));

    expect(onLigaturesEnabledChange).toHaveBeenCalledTimes(1);
    expect(onLigaturesEnabledChange.mock.calls[0]?.[0]).toBe(true);
  });
});

describe("SettingsMenu default launch directory", () => {
  it("renders the stored path in the Launch input", () => {
    renderSettingsMenu({ initialDefaultCwd: "/Users/tester/repo" });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    const input = screen.getByLabelText("default launch directory") as HTMLInputElement;
    expect(input.value).toBe("/Users/tester/repo");
  });

  it("shows the home-directory placeholder when no default is set", () => {
    renderSettingsMenu({ initialDefaultCwd: "" });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    const input = screen.getByLabelText("default launch directory") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Home directory");
  });

  it("calls onDefaultCwdChange with the typed value", () => {
    const onDefaultCwdChange = vi.fn();
    renderSettingsMenu({ initialDefaultCwd: "", onDefaultCwdChange });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    fireEvent.change(screen.getByLabelText("default launch directory"), {
      target: { value: "/Users/tester/repo" },
    });

    expect(onDefaultCwdChange).toHaveBeenCalledTimes(1);
    expect(onDefaultCwdChange.mock.calls[0]?.[0]).toBe("/Users/tester/repo");
  });
});

describe("SettingsMenu pin-to-bottom-on-input switch", () => {
  it("renders the switch in the Scrollback section reflecting the current value", () => {
    renderSettingsMenu({ initialScrollOnUserInput: true });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    const toggle = screen.getByLabelText("toggle pin to bottom on input") as HTMLButtonElement;
    expect(toggle).toBeDefined();
    // Base UI Switch reflects state via aria-checked.
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("calls onScrollOnUserInputChange with the toggled value", () => {
    const onScrollOnUserInputChange = vi.fn();
    renderSettingsMenu({ initialScrollOnUserInput: true, onScrollOnUserInputChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("toggle pin to bottom on input"));

    expect(onScrollOnUserInputChange).toHaveBeenCalledTimes(1);
    expect(onScrollOnUserInputChange.mock.calls[0]?.[0]).toBe(false);
  });
});

describe("NumberStepper drag scrubber (via the font size stepper)", () => {
  const findFontSizeSlider = () => screen.getByRole("slider", { name: "terminal font size" });

  it("dragging the value cell to the right increases the value by step per scrub-pixel-threshold", () => {
    const onFontSizeChange = vi.fn();
    renderSettingsMenu({ initialFontSize: 13, onFontSizeChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    const valueCell = findFontSizeSlider();

    fireEvent.pointerDown(valueCell, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(valueCell, { clientX: 130, pointerId: 1 });
    fireEvent.pointerUp(valueCell, { clientX: 130, pointerId: 1 });

    expect(onFontSizeChange).toHaveBeenLastCalledWith(13 + 6 * TERMINAL_FONT_SIZE_STEP_PX);
  });

  it("dragging left decreases the value", () => {
    const onFontSizeChange = vi.fn();
    renderSettingsMenu({ initialFontSize: 18, onFontSizeChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    const valueCell = findFontSizeSlider();

    fireEvent.pointerDown(valueCell, { clientX: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(valueCell, { clientX: 175, pointerId: 1 });
    fireEvent.pointerUp(valueCell, { clientX: 175, pointerId: 1 });

    expect(onFontSizeChange).toHaveBeenLastCalledWith(18 - 5 * TERMINAL_FONT_SIZE_STEP_PX);
  });

  it("does not fire onValueChange while the pointer drift is below the scrub threshold", () => {
    const onFontSizeChange = vi.fn();
    renderSettingsMenu({ initialFontSize: 13, onFontSizeChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    const valueCell = findFontSizeSlider();

    fireEvent.pointerDown(valueCell, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(valueCell, { clientX: 102, pointerId: 1 });
    fireEvent.pointerUp(valueCell, { clientX: 102, pointerId: 1 });

    expect(onFontSizeChange).not.toHaveBeenCalled();
  });

  it("clears drag state on pointerCancel so subsequent moves do not fire", () => {
    const onFontSizeChange = vi.fn();
    renderSettingsMenu({ initialFontSize: 13, onFontSizeChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    const valueCell = findFontSizeSlider();

    fireEvent.pointerDown(valueCell, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerCancel(valueCell, { pointerId: 1 });
    fireEvent.pointerMove(valueCell, { clientX: 200, pointerId: 1 });

    expect(onFontSizeChange).not.toHaveBeenCalled();
  });
});

describe("NumberStepper accessibility (via the font size stepper)", () => {
  const findFontSizeSlider = () => screen.getByRole("slider", { name: "terminal font size" });

  it("exposes ARIA slider semantics with the current numeric value", () => {
    renderSettingsMenu({ initialFontSize: 17 });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    const slider = findFontSizeSlider();

    expect(slider.getAttribute("aria-valuenow")).toBe("17");
    expect(slider.getAttribute("aria-valuemin")).toBe(String(TERMINAL_FONT_SIZE_MIN_PX));
    expect(slider.getAttribute("aria-valuemax")).toBe(String(TERMINAL_FONT_SIZE_MAX_PX));
    expect(slider.getAttribute("aria-orientation")).toBe("horizontal");
    expect(slider.tabIndex).toBe(0);
  });

  it("ArrowRight increments the value by one step", () => {
    const onFontSizeChange = vi.fn();
    renderSettingsMenu({ initialFontSize: 13, onFontSizeChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.keyDown(findFontSizeSlider(), { key: "ArrowRight" });

    expect(onFontSizeChange).toHaveBeenCalledWith(13 + TERMINAL_FONT_SIZE_STEP_PX);
  });

  it("ArrowLeft decrements the value by one step", () => {
    const onFontSizeChange = vi.fn();
    renderSettingsMenu({ initialFontSize: 13, onFontSizeChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.keyDown(findFontSizeSlider(), { key: "ArrowLeft" });

    expect(onFontSizeChange).toHaveBeenCalledWith(13 - TERMINAL_FONT_SIZE_STEP_PX);
  });

  it("Home jumps to the minimum and End jumps to the maximum", () => {
    const onFontSizeChange = vi.fn();
    renderSettingsMenu({ initialFontSize: 13, onFontSizeChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    const slider = findFontSizeSlider();

    fireEvent.keyDown(slider, { key: "Home" });
    fireEvent.keyDown(slider, { key: "End" });

    expect(onFontSizeChange).toHaveBeenNthCalledWith(1, TERMINAL_FONT_SIZE_MIN_PX);
    expect(onFontSizeChange).toHaveBeenNthCalledWith(2, TERMINAL_FONT_SIZE_MAX_PX);
  });

  it("ignores unrelated keys", () => {
    const onFontSizeChange = vi.fn();
    renderSettingsMenu({ initialFontSize: 13, onFontSizeChange });

    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.keyDown(findFontSizeSlider(), { key: "a" });
    fireEvent.keyDown(findFontSizeSlider(), { key: "Tab" });

    expect(onFontSizeChange).not.toHaveBeenCalled();
  });
});

const openThemeSelect = () => {
  fireEvent.click(screen.getByLabelText("terminal settings"));
  fireEvent.click(screen.getByLabelText("select theme"));
};

const openFontSelect = () => {
  fireEvent.click(screen.getByLabelText("terminal settings"));
  fireEvent.click(screen.getByLabelText("select font"));
};

const openCursorStyleSelect = () => {
  fireEvent.click(screen.getByLabelText("terminal settings"));
  fireEvent.click(screen.getByLabelText("select cursor style"));
};

describe("SettingsMenu live preview", () => {
  it("calls onThemePreview when the pointer enters a theme item", () => {
    const onThemePreview = vi.fn();
    renderSettingsMenu({ onThemePreview });

    openThemeSelect();
    const draculaItem = screen.getByText("Dracula");
    fireEvent.pointerEnter(draculaItem);

    expect(onThemePreview).toHaveBeenCalledWith("dracula");
  });

  it("calls onFontPreview when the pointer enters a font item", () => {
    const onFontPreview = vi.fn();
    renderSettingsMenu({ onFontPreview });

    openFontSelect();
    const jetbrainsItem = screen.getByText("JetBrains Mono");
    fireEvent.pointerEnter(jetbrainsItem);

    expect(onFontPreview).toHaveBeenCalledWith("jetbrains-mono");
  });

  it("clears the theme preview when the theme select closes", () => {
    const onThemePreview = vi.fn();
    renderSettingsMenu({ onThemePreview });

    openThemeSelect();
    fireEvent.pointerEnter(screen.getByText("Dracula"));
    onThemePreview.mockClear();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    expect(onThemePreview).toHaveBeenCalledWith(null);
  });

  it("clears the font preview when the font select closes", () => {
    const onFontPreview = vi.fn();
    renderSettingsMenu({ onFontPreview });

    openFontSelect();
    fireEvent.pointerEnter(screen.getByText("JetBrains Mono"));
    onFontPreview.mockClear();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    expect(onFontPreview).toHaveBeenCalledWith(null);
  });

  it("calls onCursorStylePreview when the pointer enters a cursor style item", () => {
    const onCursorStylePreview = vi.fn();
    renderSettingsMenu({ onCursorStylePreview });

    openCursorStyleSelect();
    const barItem = screen.getByText("Bar");
    fireEvent.pointerEnter(barItem);

    expect(onCursorStylePreview).toHaveBeenCalledWith("bar");
  });

  it("clears the cursor style preview when the cursor style select closes", () => {
    const onCursorStylePreview = vi.fn();
    renderSettingsMenu({ onCursorStylePreview });

    openCursorStyleSelect();
    fireEvent.pointerEnter(screen.getByText("Bar"));
    onCursorStylePreview.mockClear();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    expect(onCursorStylePreview).toHaveBeenCalledWith(null);
  });

  it("clears all three previews when the outer popover closes mid-hover", () => {
    const onThemePreview = vi.fn();
    const onFontPreview = vi.fn();
    const onCursorStylePreview = vi.fn();
    renderSettingsMenu({ onThemePreview, onFontPreview, onCursorStylePreview });

    openCursorStyleSelect();
    fireEvent.pointerEnter(screen.getByText("Bar"));
    onThemePreview.mockClear();
    onFontPreview.mockClear();
    onCursorStylePreview.mockClear();

    fireEvent.click(screen.getByLabelText("terminal settings"));

    expect(onThemePreview).toHaveBeenCalledWith(null);
    expect(onFontPreview).toHaveBeenCalledWith(null);
    expect(onCursorStylePreview).toHaveBeenCalledWith(null);
  });
});

describe("SettingsMenu shell section", () => {
  it("does not render the Shell section when no sessionInfo is provided", () => {
    renderSettingsMenu();
    fireEvent.click(screen.getByLabelText("terminal settings"));
    expect(screen.queryByText("Shell")).toBeNull();
  });

  it("does not render the Shell section when sessionInfo is null (pre-handshake)", () => {
    renderSettingsMenu({ sessionInfo: null });
    fireEvent.click(screen.getByLabelText("terminal settings"));
    expect(screen.queryByText("Shell")).toBeNull();
  });

  it("collapses shell info by default and only shows the trigger label", () => {
    renderSettingsMenu({
      sessionInfo: {
        shell: "/opt/homebrew/bin/fish",
        shellName: "fish",
        pid: 12345,
        cwd: "/Users/tester/Developer/localterm",
        title: "~",
      },
    });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    expect(screen.getByText("Shell")).toBeDefined();
    expect(screen.queryByText("fish")).toBeNull();
    expect(screen.queryByText("12345")).toBeNull();
  });

  it("expanding the Shell collapsible reveals name, path, pid, and cwd from sessionInfo", () => {
    renderSettingsMenu({
      sessionInfo: {
        shell: "/opt/homebrew/bin/fish",
        shellName: "fish",
        pid: 12345,
        cwd: "/Users/tester/Developer/localterm",
        title: "~",
      },
    });
    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByRole("button", { name: /shell/i }));

    expect(screen.getByText("fish")).toBeDefined();
    expect(screen.getByText("/opt/homebrew/bin/fish")).toBeDefined();
    expect(screen.getByText("12345")).toBeDefined();
    expect(screen.getByText("/Users/tester/Developer/localterm")).toBeDefined();
  });
});

describe("SettingsMenu CDP port field", () => {
  it("renders the stored port in the input", () => {
    renderSettingsMenu({ initialCdpPort: 52860 });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    const input = screen.getByLabelText("CDP remote debugging port") as HTMLInputElement;
    expect(input.value).toBe("52860");
  });

  it("shows the Auto-detect placeholder when no port is set", () => {
    renderSettingsMenu({ initialCdpPort: null });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    const input = screen.getByLabelText("CDP remote debugging port") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Auto-detect");
  });

  it("commits a valid port on blur", () => {
    const onCdpPortChange = vi.fn();
    renderSettingsMenu({ initialCdpPort: null, onCdpPortChange });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    const input = screen.getByLabelText("CDP remote debugging port");
    fireEvent.change(input, { target: { value: "52860" } });
    fireEvent.blur(input);

    expect(onCdpPortChange).toHaveBeenCalledTimes(1);
    expect(onCdpPortChange.mock.calls[0]?.[0]).toBe(52860);
  });

  it("clears the override to null when the field is emptied", () => {
    const onCdpPortChange = vi.fn();
    renderSettingsMenu({ initialCdpPort: 9222, onCdpPortChange });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    const input = screen.getByLabelText("CDP remote debugging port");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onCdpPortChange).toHaveBeenCalledWith(null);
  });

  it("rolls back an out-of-range value without calling onCdpPortChange", () => {
    const onCdpPortChange = vi.fn();
    renderSettingsMenu({ initialCdpPort: 9222, onCdpPortChange });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    const input = screen.getByLabelText("CDP remote debugging port") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99999" } });
    fireEvent.blur(input);

    expect(onCdpPortChange).not.toHaveBeenCalled();
    expect(input.value).toBe("9222");
  });

  it("shows the connected browser name when status is connected", () => {
    renderSettingsMenu({
      initialCdpPort: 52860,
      cdpStatus: { connected: true, browser: "Chrome (127.0.0.1:52860)" },
    });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    expect(screen.getByText(/Connected — Chrome \(127\.0\.0\.1:52860\)/)).toBeDefined();
  });

  it("shows a not-connected hint when status is disconnected", () => {
    renderSettingsMenu({ initialCdpPort: 52860, cdpStatus: { connected: false } });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    expect(screen.getByText(/Not connected/)).toBeDefined();
  });

  it("surfaces the connect error from status", () => {
    renderSettingsMenu({
      initialCdpPort: 52860,
      cdpStatus: { connected: false, error: "timed out after 5000ms" },
    });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    expect(screen.getByText(/Not connected — timed out after 5000ms/)).toBeDefined();
  });

  it("calls onCdpConnect when the Connect button is clicked", () => {
    const onCdpConnect = vi.fn();
    renderSettingsMenu({ initialCdpPort: 52860, onCdpConnect });
    fireEvent.click(screen.getByLabelText("terminal settings"));
    fireEvent.click(screen.getByLabelText("connect to CDP endpoint"));

    expect(onCdpConnect).toHaveBeenCalledTimes(1);
  });

  it("disables the Connect button and shows Connecting… while connecting", () => {
    renderSettingsMenu({ initialCdpPort: 52860, cdpConnecting: true });
    fireEvent.click(screen.getByLabelText("terminal settings"));

    const button = screen.getByLabelText("connect to CDP endpoint") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Connecting…");
  });
});
