import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";

// localterm renders xterm.js with the Kitty graphics + OSC 8 hyperlink addons
// loaded, but sets TERM=xterm-256color and strips terminal-identity env vars so
// Ink TUIs don't probe for a protocol xterm.js lacks. pi-tui therefore reports
// images/hyperlinks as unsupported.
//
// pi ≥ 0.84 ships the CLI as a self-contained bundle whose pi-tui copy is a
// separate module instance: setCapabilities only mutates the extension-visible
// copy while the bundled TUI keeps reading its own lazily-detected
// capabilities — so the module mutation no longer reaches the live TUI there.
// Both instances call detectCapabilities() from process.env on their first
// getCapabilities(), and extensions are imported before the bundled TUI first
// queries capabilities, so planting the Kitty identity env var here makes the
// bundled copy detect images + hyperlinks on its own. The setCapabilities call
// remains for pi ≤ 0.83, which shares one pi-tui instance with extensions.
const KITTY_IDENTITY_ENV = "KITTY_WINDOW_ID";
const LOCALTERM_MARKER = "localterm";

const plantKittyIdentityEnv = (): void => {
  if (!process.env.LOCALTERM && !process.env.LOCALTERM_SESSION_ID) return;
  process.env[KITTY_IDENTITY_ENV] ||= LOCALTERM_MARKER;
};

export const enableKittyImages = (): void => {
  plantKittyIdentityEnv();
  const capabilities = getCapabilities();
  if (capabilities.images === "kitty" && capabilities.hyperlinks) return;
  setCapabilities({ ...capabilities, images: "kitty", hyperlinks: true });
};
