export interface FilePathParts {
  readonly directory: string;
  readonly basename: string;
}

// Splits a repo-relative path into its directory (with trailing slash) and
// basename so a header can render the noisy directory muted and the file name
// emphasized. A path with no slash yields an empty directory.
export const splitFilePath = (filePath: string): FilePathParts => {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) return { directory: "", basename: filePath };
  return {
    directory: filePath.slice(0, lastSlash + 1),
    basename: filePath.slice(lastSlash + 1),
  };
};
