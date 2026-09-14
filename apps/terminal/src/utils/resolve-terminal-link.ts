const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);
const FILE_PROTOCOL = "file:";
const PARENT_SEGMENT = "..";
const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_DRIVE_PREFIX = /^\/[a-zA-Z]:[\\/]/;

// Where a clicked terminal link goes. A pane can print any URI it likes, so the
// resolver only ever yields three shapes: a browser URL, a file the daemon's
// preview routes can serve (a cwd plus a relative, ".."-free path), or nothing.
export type ResolvedTerminalLink =
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "file"; readonly cwd: string; readonly path: string }
  | { readonly kind: "unsupported" };

const UNSUPPORTED = { kind: "unsupported" } as const;

const normalizeSeparators = (value: string): string => value.replaceAll("\\", "/");

// A relative markdown href can carry a fragment or query ("docs/x.md#usage");
// neither is part of the file the preview should open.
const stripFragmentAndQuery = (value: string): string => {
  const fragmentIndex = value.indexOf("#");
  const withoutFragment = fragmentIndex === -1 ? value : value.slice(0, fragmentIndex);
  const queryIndex = withoutFragment.indexOf("?");
  return queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex);
};

const decodePathName = (pathname: string): string => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
};

const isAbsoluteFilePath = (value: string): boolean =>
  value.startsWith("/") || WINDOWS_DRIVE_PATH.test(value);

const tryParseUrl = (value: string): URL | null => {
  // "C:/Users/me/notes.md" parses as a "c:" URL, but it is a Windows path.
  if (WINDOWS_DRIVE_PATH.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

// Collapses "." and ".." so the result matches the preview routes' contract
// (relative, no ".." segment). Null when the path climbs above its own root —
// there is no cwd to resolve that against.
const collapseSegments = (value: string): string | null => {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === PARENT_SEGMENT) {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join("/");
};

// Absolute paths arrive from pi's tool output (every file path it prints is an
// OSC 8 file:// link). The preview routes take a directory plus a path inside
// it, so an absolute path is re-expressed as its own parent directory.
const resolveAbsoluteFilePath = (value: string): ResolvedTerminalLink => {
  // file:///C:/Users/me/notes.md — the file URL form of a Windows drive path
  // carries a leading slash that the path itself never has.
  const absolutePath = WINDOWS_DRIVE_PREFIX.test(value) ? value.slice(1) : value;
  const separatorIndex = absolutePath.lastIndexOf("/");
  const name = absolutePath.slice(separatorIndex + 1);
  if (name.length === 0) return UNSUPPORTED;
  const directory = absolutePath.slice(0, separatorIndex);
  return { kind: "file", cwd: directory === "" ? "/" : directory, path: name };
};

export const resolveTerminalLink = (uri: string, cwd: string | null): ResolvedTerminalLink => {
  const raw = uri.trim();
  if (raw.length === 0) return UNSUPPORTED;

  const url = tryParseUrl(raw);
  if (url) {
    if (EXTERNAL_PROTOCOLS.has(url.protocol)) return { kind: "external", url: url.href };
    if (url.protocol !== FILE_PROTOCOL) return UNSUPPORTED;
    return resolveAbsoluteFilePath(normalizeSeparators(decodePathName(url.pathname)));
  }

  const path = normalizeSeparators(stripFragmentAndQuery(raw));
  if (path.length === 0) return UNSUPPORTED;
  if (isAbsoluteFilePath(path)) return resolveAbsoluteFilePath(path);
  if (cwd === null) return UNSUPPORTED;

  // Scheme-less hrefs are relative to the pane's live cwd — pi passes the model
  // written href straight through, so "experiments/x/index.html" only means
  // something against the shell's directory, never the browser origin.
  const relativePath = collapseSegments(path);
  if (relativePath === null) return UNSUPPORTED;
  return { kind: "file", cwd, path: relativePath };
};
