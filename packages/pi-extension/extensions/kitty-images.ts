import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";

// localterm renders xterm.js with the Kitty graphics + OSC 8 hyperlink addons
// loaded, but sets TERM=xterm-256color and strips terminal-identity env vars so
// Ink TUIs don't probe for a protocol xterm.js lacks. pi-tui therefore reports
// images/hyperlinks as unsupported. Enable them while the extension factory is
// loading, before TUI.start() checks image support and sends its CSI 16 t cell-
// metrics query. Waiting for session_start is too late: the first query is then
// skipped and image sizing keeps pi-tui's fallback cell dimensions.
export const enableKittyImages = (): void => {
  const capabilities = getCapabilities();
  if (capabilities.images === "kitty" && capabilities.hyperlinks) return;
  setCapabilities({ ...capabilities, images: "kitty", hyperlinks: true });
};
