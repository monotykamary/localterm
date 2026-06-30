import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";

// localterm renders xterm.js with the Kitty graphics + OSC 8 hyperlink addons
// loaded, but sets TERM=xterm-256color and strips terminal-identity env vars so
// Ink TUIs don't probe for a protocol xterm.js lacks. pi-tui therefore reports
// images/hyperlinks as unsupported. localterm injects LOCALTERM=1 into the PTY
// env; force-enable the capabilities the rendering layer actually supports so
// images render instead of falling back to degraded inline text. Skips when
// images are already enabled (e.g. pi nested inside a real Kitty terminal).
export const registerKittyImages = (pi: ExtensionAPI): void => {
  pi.on("session_start", async () => {
    if (process.env.LOCALTERM !== "1") return;
    const capabilities = getCapabilities();
    if (capabilities.images) return;
    setCapabilities({ ...capabilities, images: "kitty", hyperlinks: true });
  });
};
