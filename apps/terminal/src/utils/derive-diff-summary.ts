import type {
  GitDiffFileListResponse,
  GitDiffSummary,
} from "@monotykamary/localterm-server/protocol";

export const deriveDiffSummary = (
  fileList: GitDiffFileListResponse,
  branch: string | null,
): GitDiffSummary => {
  let additions = 0;
  let deletions = 0;
  let binaries = 0;
  for (const file of fileList.files) {
    additions += file.additions;
    deletions += file.deletions;
    if (file.binary) binaries += 1;
  }
  return {
    isRepo: fileList.isRepo,
    files: fileList.files.length,
    additions,
    deletions,
    binaries,
    branch,
  };
};
