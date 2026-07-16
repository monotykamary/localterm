import type { CompressMode } from "@monotykamary/localterm-server/protocol";

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]" ||
  hostname === "::1";

export const detectOutputCompressMode = (hostname: string): CompressMode => {
  if (isLoopbackHostname(hostname)) return null;

  const supportsFormat = (format: string): boolean => {
    try {
      new DecompressionStream(format as CompressionFormat);
      return true;
    } catch {
      return false;
    }
  };

  if (supportsFormat("br")) return "br-ctx";
  if (supportsFormat("gzip")) return "gzip";
  return null;
};
