const FILE_CONTENT_ENDPOINT = "/api/file/content";

// /api/file/content serves a text file as text/plain for the agent-log file
// preview. Unlike /api/file (images only), it returns source/config bytes so
// the preview modal can render them inline without XSS risk (text/plain is
// never parsed as HTML, and the route adds a default-src 'none' CSP).
export const buildFileContentUrl = (cwd: string, filePath: string): string => {
  const url = new URL(FILE_CONTENT_ENDPOINT, window.location.href);
  url.searchParams.set("cwd", cwd);
  url.searchParams.set("path", filePath);
  return url.toString();
};
