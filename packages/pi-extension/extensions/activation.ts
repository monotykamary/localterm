import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgentNotify } from "./agent-notify.js";
import { registerBashSecretScrub } from "./bash-secret-scrub.js";
import { enableKittyImages } from "./kitty-images.js";

export const activate = (pi: ExtensionAPI): void => {
  enableKittyImages();
  registerBashSecretScrub(pi);
  registerAgentNotify(pi);
};
