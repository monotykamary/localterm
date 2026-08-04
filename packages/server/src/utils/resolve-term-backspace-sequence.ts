export const resolveTermBackspaceSequence = (
  platform: NodeJS.Platform = process.platform,
): string => (platform === "darwin" ? String.fromCharCode(8) : String.fromCharCode(127));
