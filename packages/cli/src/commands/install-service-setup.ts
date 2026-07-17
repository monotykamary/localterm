import kleur from "kleur";
import { CDP_REMOTE_DEBUGGING_HINT, TAILSCALE_HTTPS_PORT } from "../constants.js";
import { configureTailscaleServe } from "../utils/tailscale.js";
import { probeCdpAvailability } from "../utils/probe-cdp-availability.js";
import { readConfiguredCdpPort } from "../utils/read-configured-cdp-port.js";

export const setupTailscaleServe = async (port: number): Promise<void> => {
  console.log();
  console.log(kleur.cyan("tailscale  — share on your tailnet at https://<node>.ts.net"));
  const route = await configureTailscaleServe(port);
  if (route.registered && route.url) {
    console.log(kleur.green(`  ✔ tailnet URL: ${route.url}`));
    console.log(
      kleur.dim(`    exposed on tailnet at :${TAILSCALE_HTTPS_PORT} (HTTPS cert auto-managed)`),
    );
    return;
  }
  switch (route.reason) {
    case "binary-missing":
      console.warn(kleur.yellow(`  ⚠ tailscale not installed — skipped tailnet exposure`));
      console.warn(kleur.dim(`    install: ${route.hint ?? "https://tailscale.com/download"}`));
      break;
    case "https-disabled":
      console.warn(
        kleur.yellow(`  ⚠ tailscale HTTPS certificates are not enabled on your tailnet`),
      );
      console.warn(
        kleur.dim(
          `    enable: ${route.hint ?? "https://login.tailscale.com/admin/settings/features"}`,
        ),
      );
      console.warn(
        kleur.dim(`    then re-run: ${kleur.bold("localterm install")} to provision the cert`),
      );
      break;
    case "offline":
      console.warn(
        kleur.yellow(
          `  ⚠ tailscale not online — run \`tailscale up\` and re-run \`localterm install\``,
        ),
      );
      break;
    case "serve-mismatch":
    case undefined:
      console.warn(
        kleur.yellow(`  ⚠ could not configure tailscale serve (port ${port} not registered)`),
      );
      break;
  }
};

export const reportCdpAvailability = async (): Promise<void> => {
  console.log();
  console.log(kleur.cyan("chromium  — background automation tabs (no focus steal, closeable)"));
  const availability = await probeCdpAvailability(readConfiguredCdpPort());
  if (availability.available) {
    console.log(
      kleur.green(
        `  ✔ debug-enabled ${availability.browserName} detected — automation tabs open in the background`,
      ),
    );
    return;
  }
  console.warn(
    kleur.yellow(
      "  ⚠ no debug-enabled Chromium detected — automation tabs open in the foreground (OS opener)",
    ),
  );
  console.warn(kleur.dim(`    enable: ${CDP_REMOTE_DEBUGGING_HINT}`));
};
