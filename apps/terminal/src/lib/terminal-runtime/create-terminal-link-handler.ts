import type { ILinkHandler } from "@xterm/xterm";

// xterm's OSC 8 provider silently drops every link that isn't http(s) unless
// allowNonHttpProtocols is set. pi's links are exactly that shape — markdown
// hrefs as written and file:// tool-output paths — so without the flag they
// paint the hyperlink dashed underline yet never reach a click handler.
//
// Everything a pane prints is untrusted input, so the handler only forwards the
// raw URI: resolveTerminalLink narrows it to http(s) or a previewable file, and
// unknown schemes are dropped instead of being handed to the OS.
export const createTerminalLinkHandler = (
  openLink: (uri: string) => void,
  isApplicationMouseEvent: (event: MouseEvent) => boolean,
): ILinkHandler => ({
  allowNonHttpProtocols: true,
  activate: createTerminalWebLinksHandler(openLink, isApplicationMouseEvent),
});

// Bare http(s) text still comes from WebLinksAddon's regex provider; routing it
// through the same opener keeps one activation path (and skips the addon's own
// window.open popup trick).
export const createTerminalWebLinksHandler =
  (
    openLink: (uri: string) => void,
    isApplicationMouseEvent: (event: MouseEvent) => boolean,
  ): ((event: MouseEvent, uri: string) => void) =>
  (event, uri) => {
    // A mouse-reporting application owns the gesture, regardless of its name or
    // screen buffer. preventDefault does not stop xterm's PTY reports, so opening
    // here as well can create a second tab. Native selection overrides stay local.
    if (isApplicationMouseEvent(event)) return;
    event.preventDefault();
    openLink(uri);
  };
