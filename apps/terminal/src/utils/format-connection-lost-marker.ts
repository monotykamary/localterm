export const formatConnectionLostMarker = (closeCode: number, closeReason: string): string => {
  const reasonSuffix = closeReason ? ` · ${closeReason}` : "";
  return `\r\n\x1b[2;31m[connection lost · code ${closeCode}${reasonSuffix}]\x1b[0m\r\n`;
};
