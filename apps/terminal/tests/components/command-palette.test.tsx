import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandPalette, type CommandItem } from "../../src/components/command-palette";

interface CommandPaletteHarness {
  commands: CommandItem[];
  actions: Record<string, ReturnType<typeof vi.fn>>;
}

const buildHarness = (): CommandPaletteHarness => {
  const actions = {
    find: vi.fn(),
    gitDiff: vi.fn(),
    vesper: vi.fn(),
    dracula: vi.fn(),
  };
  const commands: CommandItem[] = [
    { id: "find", label: "Find in terminal", category: "Actions", action: actions.find },
    { id: "git-diff", label: "View git diff", category: "Actions", action: actions.gitDiff },
    {
      id: "theme:vesper",
      label: "Vesper",
      category: "Theme",
      checked: true,
      action: actions.vesper,
    },
    { id: "theme:dracula", label: "Dracula", category: "Theme", action: actions.dracula },
  ];
  return { commands, actions };
};

afterEach(cleanup);

describe("CommandPalette", () => {
  it("groups commands under category headers while browsing", () => {
    const { commands } = buildHarness();
    render(<CommandPalette open onClose={() => {}} commands={commands} />);

    expect(screen.getByRole("group", { name: "Actions" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("marks the checked command as active", () => {
    const { commands } = buildHarness();
    render(<CommandPalette open onClose={() => {}} commands={commands} />);

    const checkedOption = screen.getByRole("option", { name: /vesper/i });
    expect(checkedOption.querySelector('[aria-label="active"]')).toBeTruthy();
    const uncheckedOption = screen.getByRole("option", { name: /dracula/i });
    expect(uncheckedOption.querySelector('[aria-label="active"]')).toBeNull();
  });

  it("filters commands with fuzzy matching", () => {
    const { commands } = buildHarness();
    render(<CommandPalette open onClose={() => {}} commands={commands} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "drac" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Dracula");
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("matches commands by their category name", () => {
    const { commands } = buildHarness();
    render(<CommandPalette open onClose={() => {}} commands={commands} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "theme" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Vesper");
    expect(options[1].textContent).toContain("Dracula");
  });

  it("shows an empty state when nothing matches", () => {
    const { commands } = buildHarness();
    render(<CommandPalette open onClose={() => {}} commands={commands} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzz" } });

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/no commands match/i)).toBeTruthy();
  });

  it("runs the active command on Enter after arrow navigation", () => {
    const onClose = vi.fn();
    const { commands, actions } = buildHarness();
    render(<CommandPalette open onClose={onClose} commands={commands} />);

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(actions.gitDiff).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("navigates with ctrl+n and ctrl+p and wraps around", () => {
    const { commands } = buildHarness();
    render(<CommandPalette open onClose={() => {}} commands={commands} />);

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "n", ctrlKey: true });
    expect(screen.getByRole("option", { name: /git diff/i }).getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.keyDown(input, { key: "p", ctrlKey: true });
    fireEvent.keyDown(input, { key: "p", ctrlKey: true });
    expect(screen.getByRole("option", { name: /dracula/i }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("reports the highlighted command and clears it on close", () => {
    const onActiveItemChange = vi.fn();
    const { commands } = buildHarness();
    const { rerender } = render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={commands}
        onActiveItemChange={onActiveItemChange}
      />,
    );

    expect(onActiveItemChange).toHaveBeenLastCalledWith(commands[0]);

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(onActiveItemChange).toHaveBeenLastCalledWith(commands[1]);

    rerender(
      <CommandPalette
        open={false}
        onClose={() => {}}
        commands={commands}
        onActiveItemChange={onActiveItemChange}
      />,
    );
    expect(onActiveItemChange).toHaveBeenLastCalledWith(null);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    const { commands } = buildHarness();
    render(<CommandPalette open onClose={onClose} commands={commands} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
