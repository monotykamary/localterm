import { execFile } from "node:child_process";
import { promisify } from "node:util";
import kleur from "kleur";
import {
  PORTLESS_ALIAS_TIMEOUT_MS,
  PORTLESS_APP_NAME,
  getFriendlyUrl,
  getPortlessUrl,
} from "../constants.js";

const execFileAsync = promisify(execFile);

export interface PortlessRoute {
  url: string;
  registered: boolean;
  warning?: string;
}

const isPortlessMissing = (error: unknown): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";

export const ensurePortlessRoute = async (port: number): Promise<PortlessRoute> => {
  try {
    await execFileAsync("portless", ["alias", PORTLESS_APP_NAME, String(port), "--force"], {
      timeout: PORTLESS_ALIAS_TIMEOUT_MS,
    });
    return { url: getPortlessUrl(), registered: true };
  } catch (error) {
    if (isPortlessMissing(error)) {
      return { url: getFriendlyUrl(port), registered: false };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      url: getFriendlyUrl(port),
      registered: false,
      warning: `portless route not registered (${message}) — open the direct URL above`,
    };
  }
};

export const announcePortlessRoute = (route: PortlessRoute): void => {
  if (route.warning) {
    console.log(kleur.yellow(`  ⚠ ${route.warning}`));
  }
};
