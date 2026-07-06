if (import.meta.env.DEV) {
  import("react-grab");
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TOOLTIP_DELAY_MS } from "@/lib/constants";
import { applyTabFavicon } from "./utils/apply-tab-favicon";
import { registerServiceWorker } from "./utils/register-service-worker";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/700.css";
// All other terminal fonts are bundled via fontsource (not fetched from
// fonts.googleapis.com at runtime) so they render on an air-gapped Linux VPS
// reachable only over ssh/tailnet — the offline-hostile case the runtime
// Google Fonts <link> silently failed on (10 of 11 fonts fell back to the
// generic monospace). DM Mono tops out at weight 500 (no 700), so its heaviest
// available weight is used for the bold face.
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/700.css";
import "@fontsource/source-code-pro/400.css";
import "@fontsource/source-code-pro/700.css";
import "@fontsource/roboto-mono/400.css";
import "@fontsource/roboto-mono/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "@fontsource/inconsolata/400.css";
import "@fontsource/inconsolata/700.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/ubuntu-mono/400.css";
import "@fontsource/ubuntu-mono/700.css";
import "@fontsource/anonymous-pro/400.css";
import "@fontsource/anonymous-pro/700.css";
import "./nerd-font.css";
import "./index.css";

applyTabFavicon();
registerServiceWorker();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <TooltipProvider delay={TOOLTIP_DELAY_MS}>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
