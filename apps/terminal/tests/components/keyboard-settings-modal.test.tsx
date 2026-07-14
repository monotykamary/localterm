import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { KeyboardSettingsModal } from "../../src/components/on-screen-keyboard/keyboard-settings-modal";
import {
  DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT,
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  KEYBOARD_HEIGHT_SCALE_STEP_PERCENT,
  TERMINAL_FONT_SIZE_STEP_PX,
  TERMINAL_LINE_HEIGHT_STEP,
} from "../../src/lib/constants";

const renderModal = () => {
  const onHeightScaleChange = vi.fn();
  const onTerminalFontSizeChange = vi.fn();
  const onTerminalLineHeightChange = vi.fn();
  const onHapticsEnabledChange = vi.fn();
  const onKeyPreviewEnabledChange = vi.fn();
  const onKeyRepeatEnabledChange = vi.fn();
  const onReset = vi.fn();
  const onClose = vi.fn();
  render(
    <KeyboardSettingsModal
      heightScalePercent={DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT}
      terminalFontSize={DEFAULT_TERMINAL_FONT_SIZE_PX}
      terminalLineHeight={DEFAULT_TERMINAL_LINE_HEIGHT}
      hapticsEnabled
      keyPreviewEnabled
      keyRepeatEnabled
      onHeightScaleChange={onHeightScaleChange}
      onTerminalFontSizeChange={onTerminalFontSizeChange}
      onTerminalLineHeightChange={onTerminalLineHeightChange}
      onHapticsEnabledChange={onHapticsEnabledChange}
      onKeyPreviewEnabledChange={onKeyPreviewEnabledChange}
      onKeyRepeatEnabledChange={onKeyRepeatEnabledChange}
      onReset={onReset}
      onClose={onClose}
    />,
  );
  return {
    onHeightScaleChange,
    onTerminalFontSizeChange,
    onTerminalLineHeightChange,
    onHapticsEnabledChange,
    onKeyPreviewEnabledChange,
    onKeyRepeatEnabledChange,
    onReset,
    onClose,
  };
};

describe("KeyboardSettingsModal", () => {
  it("changes keyboard height and terminal typography independently", () => {
    const callbacks = renderModal();
    fireEvent.click(screen.getByLabelText("increase keyboard height"));
    fireEvent.click(screen.getByLabelText("increase terminal font size"));
    fireEvent.click(screen.getByLabelText("increase terminal line spacing"));
    expect(callbacks.onHeightScaleChange).toHaveBeenCalledWith(
      DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT + KEYBOARD_HEIGHT_SCALE_STEP_PERCENT,
    );
    expect(callbacks.onTerminalFontSizeChange).toHaveBeenCalledWith(
      DEFAULT_TERMINAL_FONT_SIZE_PX + TERMINAL_FONT_SIZE_STEP_PX,
    );
    expect(callbacks.onTerminalLineHeightChange.mock.calls[0]?.[0]).toBeCloseTo(
      DEFAULT_TERMINAL_LINE_HEIGHT + TERMINAL_LINE_HEIGHT_STEP,
    );
  });

  it("exposes haptics, previews, repeat, reset, and close controls", () => {
    const callbacks = renderModal();
    fireEvent.click(screen.getByLabelText("toggle keyboard haptic feedback"));
    fireEvent.click(screen.getByLabelText("toggle keyboard key previews"));
    fireEvent.click(screen.getByLabelText("toggle keyboard key repeat"));
    fireEvent.click(screen.getByText("Reset defaults"));
    fireEvent.click(screen.getByLabelText("close keyboard settings"));
    expect(callbacks.onHapticsEnabledChange.mock.calls[0]?.[0]).toBe(false);
    expect(callbacks.onKeyPreviewEnabledChange.mock.calls[0]?.[0]).toBe(false);
    expect(callbacks.onKeyRepeatEnabledChange.mock.calls[0]?.[0]).toBe(false);
    expect(callbacks.onReset).toHaveBeenCalledOnce();
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
});
