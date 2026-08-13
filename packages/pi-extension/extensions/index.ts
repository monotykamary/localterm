import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async (pi: ExtensionAPI): Promise<void> => {
  if (process.env.LOCALTERM !== "1") return;
  const { activate } = await import("./activation.js");
  activate(pi);
};
