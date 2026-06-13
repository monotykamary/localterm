import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AutomationsButton } from "../../src/components/automations-menu";

describe("AutomationsButton", () => {
  afterEach(cleanup);

  it("renders the toolbar trigger and opens the modal on click", () => {
    const onOpen = vi.fn();
    render(<AutomationsButton onOpen={onOpen} isMac />);
    const button = screen.getByLabelText("automations");
    expect(button.getAttribute("title")).toBe("⌘J");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows the Ctrl shortcut hint off macOS", () => {
    render(<AutomationsButton onOpen={() => {}} isMac={false} />);
    expect(screen.getByLabelText("automations").getAttribute("title")).toBe("Ctrl+J");
  });
});
