import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activate } from "./activation.js";

export default async (pi: ExtensionAPI): Promise<void> => {
  if (process.env.LOCALTERM !== "1") return;
  activate(pi);
};
