import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBashSecretScrub } from "./bash-secret-scrub.js";
import { registerKittyImages } from "./kitty-images.js";

// localterm <-> pi integration, inert outside localterm. LOCALTERM=1 is
// injected into every localterm PTY; when it's absent, nothing is registered
// and pi behaves exactly as default. Inside localterm this (1) force-enables
// Kitty graphics + OSC 8 links the xterm.js renderer supports but pi-tui can't
// detect, and (2) scrubs localterm-managed secret env vars from the agent's
// bash-tool children so a generated command can't read keys the shim injected
// into pi's own env.
export default (pi: ExtensionAPI): void => {
  if (process.env.LOCALTERM !== "1") return;
  registerKittyImages(pi);
  registerBashSecretScrub(pi);
};
