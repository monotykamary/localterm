import type { ILinkHandler } from "@xterm/xterm";

// xterm's OSC 8 provider silently drops every link that isn't http(s) unless
// allowNonHttpProtocols is set. pi's links are exactly that shape — markdown
// hrefs as written and file:// tool-output paths — so without the flag they
// paint the hyperlink dashed underline yet never reach a click handler.
//
// Everything a pane prints is untrusted input, so the handler only forwards the
// raw URI: resolveTerminalLink narrows it to http(s) or a previewable file, and
// unknown schemes are dropped instead of being handed to the OS.
export const createTerminalLinkHandler = (openLink: (uri: string) => void): ILinkHandler => ({
  allowNonHttpProtocols: true,
  activate: (event, uri) => {
    event.preventDefault();
    openLink(uri);
  },
});

// Bare http(s) text still comes from WebLinksAddon's regex provider; routing it
// through the same opener keeps one activation path (and skips the addon's own
// window.open popup trick).
export const createTerminalWebLinksHandler =
  (openLink: (uri: string) => void): ((event: MouseEvent, uri: string) => void) =>
  (event, uri) => {
    event.preventDefault();
    openLink(uri);
  };
