import { BASE_BRANCHES } from "@/lib/constants";

const baseBranchSet = new Set(BASE_BRANCHES.map((branch) => branch.toLowerCase()));

export const isBaseBranch = (branch: string | null): boolean => {
  if (!branch) return false;
  const bareName = branch.includes("/") ? branch.slice(branch.lastIndexOf("/") + 1) : branch;
  return baseBranchSet.has(bareName.toLowerCase());
};
