import { DIFF_VIEW_MODE_STORAGE_KEY } from "@/lib/constants";
import { createStringValidatedStoredSetting } from "@/utils/create-stored-setting";

export type DiffViewMode = "unified" | "split";

const DEFAULT_DIFF_VIEW_MODE: DiffViewMode = "unified";

const isDiffViewMode = (value: string): value is DiffViewMode =>
  value === "unified" || value === "split";

const setting = createStringValidatedStoredSetting(
  DIFF_VIEW_MODE_STORAGE_KEY,
  DEFAULT_DIFF_VIEW_MODE,
  isDiffViewMode,
);

export const loadStoredDiffViewMode = setting.load;
export const storeDiffViewMode = setting.store;
