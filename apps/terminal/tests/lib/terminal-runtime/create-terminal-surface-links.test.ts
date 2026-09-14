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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createTerminalSurface link handling", () => {
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
