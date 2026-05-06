export const formatShellExitMarker = (exitCode: number | null): string => {
  const description = exitCode === null ? "shell exited" : `shell exited with code ${exitCode}`;
  return `\r\n\x1b[2;31m[${description}]\x1b[0m\r\n`;
};
