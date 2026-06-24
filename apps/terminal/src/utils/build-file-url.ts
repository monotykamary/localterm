const FILE_ENDPOINT = "/api/file";

// /api/file serves image bytes directly, so the browser renders the response
// natively when opened in a new tab (and <img> can point at it for the preview).
export const buildFileUrl = (cwd: string, filePath: string): string => {
  const url = new URL(FILE_ENDPOINT, window.location.href);
  url.searchParams.set("cwd", cwd);
  url.searchParams.set("path", filePath);
  return url.toString();
};
