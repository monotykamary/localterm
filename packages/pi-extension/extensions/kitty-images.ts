import { resetCapabilitiesCache } from "@earendil-works/pi-tui";

export const enableKittyImages = (): void => {
  if (process.env.LOCALTERM !== "1") return;

  // Pi's bundled TUI and extension-visible TUI can be separate module instances.
  // Documented env overrides reach both without spoofing another terminal to
  // child processes. Pi's explicit terminal settings still take precedence.
  if (!process.env.PI_IMAGE_PROTOCOL || process.env.PI_IMAGE_PROTOCOL === "auto") {
    process.env.PI_IMAGE_PROTOCOL = "kitty";
  }
  if (!process.env.PI_HYPERLINKS || process.env.PI_HYPERLINKS === "auto") {
    process.env.PI_HYPERLINKS = "1";
  }
  resetCapabilitiesCache();
};
