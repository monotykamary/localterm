import type { IBufferRange, Terminal as XtermTerminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createTerminalSurface } from "../../../src/lib/terminal-runtime/create-terminal-surface";
import { findTerminalFontById } from "../../../src/lib/terminal-fonts";

interface TerminalLink {
  readonly text: string;
  readonly range: IBufferRange;
  activate: (event: MouseEvent, text: string, range: IBufferRange) => void;
}

interface LinkProviderStub {
  provideLinks: (line: number, callback: (links?: TerminalLink[]) => void) => void;
}

// The click layer is fed by the link provider service, so reading it is the only
// way to assert what a real mouse-up would see. xterm keeps providers private.
const linkProvidersOf = (terminal: XtermTerminal): LinkProviderStub[] =>
  (
    terminal as unknown as {
      _core: { _linkProviderService: { linkProviders: LinkProviderStub[] } };
    }
  )._core._linkProviderService.linkProviders;

const writeLink = (terminal: XtermTerminal, uri: string) =>
  new Promise<void>((resolve) => {
    terminal.write(`\u001b]8;;${uri}\u001b\\Searchable dashboard\u001b]8;;\u001b\\\r\n`, () =>
      resolve(),
    );
  });

const linksOnLine = (terminal: XtermTerminal, line: number): Promise<TerminalLink[]> =>
  new Promise((resolve) => {
    const providers = linkProvidersOf(terminal);
    const found: TerminalLink[] = [];
    let pending = providers.length;
    if (pending === 0) {
      resolve(found);
      return;
    }
    for (const provider of providers) {
      provider.provideLinks(line, (links) => {
        for (const link of links ?? []) found.push(link);
        pending -= 1;
        if (pending === 0) resolve(found);
      });
    }
  });

const clickLinkOnLine = async (
  terminal: XtermTerminal,
  line: number,
  uri: string,
  openLink: (uri: string) => void,
) => {
  const [link] = await linksOnLine(terminal, line);
  if (!link) throw new Error(`xterm exposed no link for ${uri}`);
  link.activate(new MouseEvent("mouseup"), link.text, link.range);
  expect(openLink).toHaveBeenCalledWith(uri);
};

const installBrowserStubs = () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        measureText: (text: string) => ({ width: text.length * 6 }),
        clearRect: () => undefined,
      }) as never,
  );
  // jsdom has no canvas for xterm's renderers, and every render path is
  // decoupled from the buffer model the link providers read — freeze the render
  // clock rather than teaching jsdom to paint.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  // xterm's browser services read matchMedia for the device pixel ratio.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
};

const createSurface = (openLink: (uri: string) => void) => {
  installBrowserStubs();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const surface = createTerminalSurface({
    container,
    initialCursorBlink: false,
    initialCursorStyle: "bar",
    initialFont: findTerminalFontById(null),
    initialFontSize: 13,
    initialLineHeight: 1.2,
    initialMuteEmojiColors: false,
    initialNerdFontEnabled: false,
    initialScrollback: 1000,
    initialScrollOnUserInput: false,
    initialTheme: { id: "custom", name: "Custom", source: "test", colors: {} },
    fitAddonRef: { current: null },
    searchAddonRef: { current: null },
    webglAddonRef: { current: null },
    openLink,
    setSearchResults: () => undefined,
  });
  return {
    surface,
    dispose: () => {
      surface.dispose();
      container.remove();
    },
  };
};

const writeTerminal = (terminal: XtermTerminal, data: string) =>
  new Promise<void>((resolve) => terminal.write(data, resolve));

const installMouseGeometry = (terminal: XtermTerminal) => {
  // Exercise xterm's real DOM listeners and protocol encoder; only layout is
  // missing in jsdom. Coordinates are one-based for links, zero-based for reports.
  const { _mouseCoordsService } = (
    terminal as unknown as {
      _core: {
        _mouseCoordsService: {
          getCoords: () => [number, number];
          getMouseReportCoords: () => { col: number; row: number; x: number; y: number };
        };
      };
    }
  )._core;
  vi.spyOn(_mouseCoordsService, "getCoords").mockImplementation(() => [2, 1]);
  vi.spyOn(_mouseCoordsService, "getMouseReportCoords").mockReturnValue({
    col: 1,
    row: 0,
    x: 10,
    y: 10,
  });
};

const clickTerminal = (terminal: XtermTerminal, modifiers: MouseEventInit = {}) => {
  const screen = terminal.element?.querySelector(".xterm-screen");
  if (!screen) throw new Error("xterm screen missing");
  for (const type of ["mousemove", "mousedown", "mouseup", "click"]) {
    screen.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === "mousedown" ? 1 : 0,
        clientX: 10,
        clientY: 10,
        detail: 1,
        ...modifiers,
      }),
    );
  }
};

const EXTERNAL_URL = "https://example.com/dashboard";
const LINK_OUTPUTS = [
  { name: "bare URL", data: EXTERNAL_URL },
  { name: "OSC 8 label", data: `\u001b]8;;${EXTERNAL_URL}\u001b\\Dashboard\u001b]8;;\u001b\\` },
  {
    name: "OSC 8 URL overlapping the web-link provider",
    data: `\u001b]8;;${EXTERNAL_URL}\u001b\\${EXTERNAL_URL}\u001b]8;;\u001b\\`,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const BUFFER_MODES = [
  { name: "normal", enter: "" },
  { name: "alternate", enter: "\u001b[?1049h" },
];
const MOUSE_ENCODINGS = [
  { name: "legacy", enable: "", press: '\u001b[M "!', release: '\u001b[M#"!' },
  { name: "SGR", enable: "\u001b[?1006h", press: "\u001b[<0;2;1M", release: "\u001b[<0;2;1m" },
];
const ALL_LINK_OUTPUTS = [
  ...LINK_OUTPUTS.map((link) => ({ ...link, uri: EXTERNAL_URL })),
  ...["file:///Users/me/project/report.md", "reports/index.html"].map((uri) => ({
    name: uri,
    uri,
    data: `\u001b]8;;${uri}\u001b\\Report\u001b]8;;\u001b\\`,
  })),
];

describe("createTerminalSurface link handling", () => {
  describe.each(BUFFER_MODES)("$name buffer", ({ enter }) => {
    it.each(ALL_LINK_OUTPUTS)(
      "opens $name locally without mouse tracking",
      async ({ data, uri }) => {
        const openLink = vi.fn();
        const { surface, dispose } = createSurface(openLink);
        try {
          installMouseGeometry(surface.terminal);
          await writeTerminal(surface.terminal, enter + data);
          clickTerminal(surface.terminal);
          expect(openLink).toHaveBeenCalledExactlyOnceWith(uri);
        } finally {
          dispose();
        }
      },
    );

    describe.each(MOUSE_ENCODINGS)("$name mouse encoding", ({ enable, press, release }) => {
      describe.each([9, 1000, 1002, 1003])("tracking mode %i", (mode) => {
        it.each(ALL_LINK_OUTPUTS)(
          "delegates $name and restores local handling dynamically",
          async ({ data, uri }) => {
            const openLink = vi.fn();
            const { surface, dispose } = createSurface(openLink);
            try {
              const { terminal } = surface;
              installMouseGeometry(terminal);
              const input: string[] = [];
              terminal.onData((report) => input.push(report));
              terminal.onBinary((report) => input.push(report));
              await writeTerminal(terminal, enter + data);
              clickTerminal(terminal);
              expect(openLink).toHaveBeenCalledExactlyOnceWith(uri);
              openLink.mockClear();

              await writeTerminal(terminal, `\u001b[?${mode}h${enable}`);
              clickTerminal(terminal);
              expect(openLink).not.toHaveBeenCalled();
              expect(input).toContain(press);
              if (mode === 9) expect(input).not.toContain(release);
              else expect(input).toContain(release);

              await writeTerminal(terminal, `\u001b[?${mode}l\u001b[?1006l`);
              input.length = 0;
              clickTerminal(terminal);
              expect(openLink).toHaveBeenCalledExactlyOnceWith(uri);
              expect(input).toEqual([]);
            } finally {
              dispose();
            }
          },
        );
      });
    });
  });

  it("does not mistake leaving the alternate screen for disabling mouse reporting", async () => {
    const openLink = vi.fn();
    const { surface, dispose } = createSurface(openLink);
    try {
      const { terminal } = surface;
      installMouseGeometry(terminal);
      await writeTerminal(terminal, EXTERNAL_URL + "\u001b[?1049h\u001b[?1002h\u001b[?1049l");
      expect(terminal.buffer.active.type).toBe("normal");
      clickTerminal(terminal);
      expect(openLink).not.toHaveBeenCalled();
      terminal.reset();
      await writeTerminal(terminal, EXTERNAL_URL);
      expect(terminal.modes.mouseTrackingMode).toBe("none");
      // Reset clears the hover cache; the frozen render clock cannot refill it.
      await clickLinkOnLine(terminal, 1, EXTERNAL_URL, openLink);
      expect(openLink).toHaveBeenCalledExactlyOnceWith(EXTERNAL_URL);
    } finally {
      dispose();
    }
  });

  describe.each([
    { name: "Shift selection", modifiers: { shiftKey: true }, requireAlt: false },
    { name: "unmodified Alt-gated selection", modifiers: {}, requireAlt: true },
  ])("native $name", ({ modifiers, requireAlt }) => {
    it.each(LINK_OUTPUTS)(
      "opens $name locally without forwarding the gesture",
      async ({ data }) => {
        const openLink = vi.fn();
        const { surface, dispose } = createSurface(openLink);
        try {
          const { terminal } = surface;
          installMouseGeometry(terminal);
          terminal.options.mouseEventsRequireAlt = requireAlt;
          const input = vi.fn();
          terminal.onData(input);
          await writeTerminal(terminal, "\u001b[?1002h\u001b[?1006h" + data);
          clickTerminal(terminal, modifiers);
          expect(openLink).toHaveBeenCalledExactlyOnceWith(EXTERNAL_URL);
          expect(input).not.toHaveBeenCalled();
        } finally {
          dispose();
        }
      },
    );
  });

  it("delegates Alt-gated application clicks when Alt is held", async () => {
    const openLink = vi.fn();
    const { surface, dispose } = createSurface(openLink);
    try {
      const { terminal } = surface;
      installMouseGeometry(terminal);
      terminal.options.mouseEventsRequireAlt = true;
      const input = vi.fn();
      terminal.onData(input);
      await writeTerminal(terminal, "\u001b[?1002h\u001b[?1006h" + EXTERNAL_URL);
      clickTerminal(terminal, { altKey: true });
      expect(openLink).not.toHaveBeenCalled();
      expect(input).toHaveBeenCalledWith("\u001b[<0;2;1M");
      expect(input).toHaveBeenCalledWith("\u001b[<0;2;1m");
    } finally {
      dispose();
    }
  });
  it.each(LINK_OUTPUTS)(
    "opens a $name once without application mouse tracking",
    async ({ data }) => {
      const openLink = vi.fn();
      const { surface, dispose } = createSurface(openLink);
      try {
        const { terminal } = surface;
        installMouseGeometry(terminal);
        const input = vi.fn();
        terminal.onData(input);
        await writeTerminal(terminal, data);

        clickTerminal(terminal);

        expect(openLink).toHaveBeenCalledExactlyOnceWith(EXTERNAL_URL);
        expect(input).not.toHaveBeenCalled();
      } finally {
        dispose();
      }
    },
  );

  describe.each([1000, 1002, 1003])("application mouse mode %i", (mode) => {
    it.each(LINK_OUTPUTS)(
      "leaves $name activation to the application until tracking ends",
      async ({ data }) => {
        const openLink = vi.fn();
        const applicationOpenLink = vi.fn();
        const { surface, dispose } = createSurface(openLink);
        try {
          const { terminal } = surface;
          installMouseGeometry(terminal);
          const input: string[] = [];
          terminal.onData((report) => {
            input.push(report);
            // Pi's fullscreen TUI activates the pressed link on mouse release.
            if (report === "\u001b[<0;2;1m") applicationOpenLink(EXTERNAL_URL);
          });
          await writeTerminal(terminal, `\u001b[?${mode}h\u001b[?1006h${data}`);

          clickTerminal(terminal);

          expect(openLink).not.toHaveBeenCalled();
          expect(applicationOpenLink).toHaveBeenCalledExactlyOnceWith(EXTERNAL_URL);
          expect(input).toContain("\u001b[<0;2;1M");
          expect(input).toContain("\u001b[<0;2;1m");

          await writeTerminal(terminal, `\u001b[?${mode}l\u001b[?1006l`);
          input.length = 0;
          applicationOpenLink.mockClear();
          clickTerminal(terminal);

          expect(openLink).toHaveBeenCalledExactlyOnceWith(EXTERNAL_URL);
          expect(applicationOpenLink).not.toHaveBeenCalled();
          expect(input).toEqual([]);
        } finally {
          dispose();
        }
      },
    );
  });
  it("hands non-http OSC 8 links to the opener instead of dropping them", async () => {
    const openLink = vi.fn();
    const { surface, dispose } = createSurface(openLink);
    expect(surface.terminal.options.linkHandler?.allowNonHttpProtocols).toBe(true);

    // pi's markdown href as written, and the file:// link it prints for a path
    // in tool output — both were invisible to the click layer before.
    const relative = "experiments/vietnam-imports/reports/index.html";
    const file = "file:///Users/me/project/reports/VIABILITY.md";
    await writeLink(surface.terminal, relative);
    await writeLink(surface.terminal, file);

    await clickLinkOnLine(surface.terminal, 1, relative, openLink);
    await clickLinkOnLine(surface.terminal, 2, file, openLink);
    dispose();
  });

  it("still routes http links through the same opener", async () => {
    const openLink = vi.fn();
    const { surface, dispose } = createSurface(openLink);
    const external = "https://example.com/dashboard";

    await writeLink(surface.terminal, external);
    await clickLinkOnLine(surface.terminal, 1, external, openLink);
    dispose();
  });
});
