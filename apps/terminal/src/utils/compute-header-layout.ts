import { prepareWithSegments, measureNaturalWidth } from "@chenglou/pretext";
import { DIFF_VIEWER_BRANCH_SELECT_MIN_WIDTH_PX } from "@/lib/constants";

const SANS_12PX = "12px system-ui, -apple-system, sans-serif";
const SANS_MEDIUM_14PX = "500 14px system-ui, -apple-system, sans-serif";
const MONO_11PX = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const MONO_12PX = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const RADIO_H_CHROME_PX = 6;
const BTN_H_PAD_PX = 16;
const BADGE_H_CHROME_PX = 22;
const BADGE_ICON_PX = 12;
const SELECT_PADDING_PX = 12;
const SELECT_CHEVRON_PX = 20;
const ICON_14_PX = 14;
const GAP_1_PX = 4;
const GAP_1_5_PX = 6;
const GAP_2_PX = 8;
const GAP_3_PX = 12;
const BUTTON_ICON_SM_PX = 32;

const HEADER_PAD_FULL_PX = 32;
const HEADER_PAD_COMPACT_PX = 24;
const SAFETY_MARGIN_PX = 4;
const HYSTERESIS_PX = 16;

const measureTextWidth = (text: string, font: string): number => {
  try {
    const prepared = prepareWithSegments(text, font);
    return measureNaturalWidth(prepared);
  } catch {
    const avgCharWidth = font.includes("mono") ? 6.6 : 6.8;
    return text.length * avgCharWidth;
  }
};

const S = {
  changesTitle: measureTextWidth("Changes", SANS_MEDIUM_14PX),
  working: measureTextWidth("Working", SANS_12PX),
  branch: measureTextWidth("Branch", SANS_12PX),
  w: measureTextWidth("W", SANS_12PX),
  b: measureTextWidth("B", SANS_12PX),
  vs: measureTextWidth("vs", SANS_12PX),
  unified: measureTextWidth("unified", SANS_12PX),
  split: measureTextWidth("split", SANS_12PX),
  u: measureTextWidth("U", SANS_12PX),
  s: measureTextWidth("S", SANS_12PX),
};

const radioGroupWidth = (label1Width: number, label2Width: number): number =>
  RADIO_H_CHROME_PX + (label1Width + BTN_H_PAD_PX) + (label2Width + BTN_H_PAD_PX);

const COMPARE_FULL_WIDTH = radioGroupWidth(S.working, S.branch);
const COMPARE_ABBR_WIDTH = radioGroupWidth(S.w, S.b);
const LAYOUT_FULL_WIDTH = radioGroupWidth(S.unified, S.split);
const LAYOUT_ABBR_WIDTH = radioGroupWidth(S.u, S.s);

const RIGHT_DIV_INTERNAL_GAP = GAP_1_PX;

const rightDivWidth = (layoutLabels: "full" | "abbreviated", showRefresh: boolean): number => {
  const layoutWidth = layoutLabels === "full" ? LAYOUT_FULL_WIDTH : LAYOUT_ABBR_WIDTH;
  let width = layoutWidth + RIGHT_DIV_INTERNAL_GAP + BUTTON_ICON_SM_PX;
  if (showRefresh) {
    width += RIGHT_DIV_INTERNAL_GAP + BUTTON_ICON_SM_PX;
  }
  return width;
};

const badgeMinWidth = (prNumber: number, prState: string): number => {
  const prNumWidth = measureTextWidth(`#${prNumber}`, MONO_11PX);
  let width = BADGE_H_CHROME_PX + BADGE_ICON_PX + GAP_1_PX + prNumWidth;
  if (prState !== "open") {
    width += GAP_1_PX + measureTextWidth(prState, MONO_11PX);
  }
  return width;
};

const badgeFullWidth = (prNumber: number, prState: string, prTitleWidth: number): number => {
  const min = badgeMinWidth(prNumber, prState);
  return min + GAP_1_PX + prTitleWidth;
};

const statsMinWidth = (additions: number, deletions: number): number => {
  const addText = `+${additions.toLocaleString()}`;
  const delText = `−${deletions.toLocaleString()}`;
  const spaceWidth = measureTextWidth(" ", MONO_12PX);
  return measureTextWidth(addText, MONO_12PX) + spaceWidth + measureTextWidth(delText, MONO_12PX);
};

const statsFullWidth = (additions: number, deletions: number, binaryCount: number): number => {
  const min = statsMinWidth(additions, deletions);
  if (binaryCount <= 0) return min;
  const binText = ` · ${binaryCount} binary`;
  return min + measureTextWidth(binText, MONO_12PX);
};

const branchSelectNaturalWidth = (branchName: string | null): number =>
  measureTextWidth(branchName ?? "", MONO_12PX) + SELECT_PADDING_PX + SELECT_CHEVRON_PX;

const branchAreaWidth = (selectWidth: number, showVs: boolean): number =>
  ICON_14_PX + GAP_1_5_PX + selectWidth + (showVs ? S.vs + GAP_1_5_PX : 0);

interface HeaderLayout {
  showTitle: boolean;
  compareLabels: "full" | "abbreviated";
  showVs: boolean;
  showPr: boolean;
  prShowTitle: boolean;
  layoutLabels: "full" | "abbreviated";
  showBinaryCount: boolean;
  showStats: boolean;
  showLayoutSelector: boolean;
  showRefresh: boolean;
  headerGap: number;
  headerPadding: number;
}

export interface HeaderLayoutResult extends HeaderLayout {
  selectWidthPx: number;
  requiredWidthPx: number;
  fitsAvailableWidth: boolean;
  configIndex: number;
}

export interface HeaderLayoutParams {
  availableWidth: number;
  pr: { number: number; state: string; title: string | null } | null;
  isBranchMode: boolean;
  selectedBranch: string | null;
  additions: number;
  deletions: number;
  binaryCount: number;
  isLoading: boolean;
  previousConfigIndex?: number;
}

const COMPACT_LAYOUT = {
  showTitle: false,
  compareLabels: "abbreviated",
  showVs: false,
  showPr: true,
  prShowTitle: false,
  layoutLabels: "abbreviated",
  showBinaryCount: false,
  showStats: true,
  showLayoutSelector: true,
  showRefresh: false,
  headerGap: GAP_2_PX,
  headerPadding: HEADER_PAD_COMPACT_PX,
} satisfies HeaderLayout;

const LAYOUT_CONFIGS: HeaderLayout[] = [
  {
    ...COMPACT_LAYOUT,
    showTitle: true,
    compareLabels: "full",
    showVs: true,
    prShowTitle: true,
    layoutLabels: "full",
    showBinaryCount: true,
    showRefresh: true,
    headerGap: GAP_3_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    ...COMPACT_LAYOUT,
    showTitle: true,
    compareLabels: "full",
    showVs: true,
    prShowTitle: true,
    showBinaryCount: true,
    showRefresh: true,
    headerGap: GAP_3_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    ...COMPACT_LAYOUT,
    showTitle: true,
    compareLabels: "full",
    showVs: true,
    showBinaryCount: true,
    showRefresh: true,
    headerGap: GAP_3_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    ...COMPACT_LAYOUT,
    showTitle: true,
    compareLabels: "full",
    showBinaryCount: true,
    showRefresh: true,
    headerGap: GAP_3_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    ...COMPACT_LAYOUT,
    showTitle: true,
    showRefresh: true,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  { ...COMPACT_LAYOUT, showRefresh: true },
  COMPACT_LAYOUT,
  { ...COMPACT_LAYOUT, showStats: false },
  { ...COMPACT_LAYOUT, showStats: false, showLayoutSelector: false },
  { ...COMPACT_LAYOUT, showPr: false, showStats: false, showLayoutSelector: false },
];

// The header is a flex row with gap-{N}:
//   [title?] [compare] [branch?] [pr?] [stats] [flex-1 spacer] [trailing div]
// The trailing div bundles [layout radio] [gap-1] [refresh] [gap-1] [close]
// as a single flex item, so header gap applies between left items and the
// right div — not between the right div's internal children.
const computeConfigWidth = (
  config: HeaderLayout,
  isBranchMode: boolean,
  branchMinWidth: number,
  branchFullWidth: number,
  isPr: boolean,
  prMinWidth: number,
  prFullWidth: number,
  statMin: number,
  statFull: number,
  isLoading: boolean,
): number => {
  const leftElements: number[] = [];
  if (config.showTitle) leftElements.push(S.changesTitle);
  leftElements.push(config.compareLabels === "full" ? COMPARE_FULL_WIDTH : COMPARE_ABBR_WIDTH);
  if (isBranchMode) leftElements.push(config.showVs ? branchFullWidth : branchMinWidth);
  if (isPr && config.showPr) {
    leftElements.push(config.prShowTitle ? prFullWidth : prMinWidth);
  }
  if (config.showStats) leftElements.push(config.showBinaryCount ? statFull : statMin);
  if (isLoading && config.showStats) leftElements.push(ICON_14_PX);

  const rightDiv = config.showLayoutSelector
    ? rightDivWidth(config.layoutLabels, config.showRefresh)
    : BUTTON_ICON_SM_PX;

  // left items + right div = (leftCount + 1) flex items → leftCount gaps
  const leftCount = leftElements.length;
  const leftContent = leftElements.reduce((sum, w) => sum + w, 0);
  const gapsWidth = leftCount * config.headerGap;

  return leftContent + rightDiv + gapsWidth + config.headerPadding + SAFETY_MARGIN_PX;
};

export const computeHeaderLayout = (params: HeaderLayoutParams): HeaderLayoutResult => {
  const {
    availableWidth,
    pr,
    isBranchMode,
    selectedBranch,
    additions,
    deletions,
    binaryCount,
    isLoading,
    previousConfigIndex,
  } = params;

  // Width unmeasured yet — return the fullest layout so nothing is hidden
  // before the first ResizeObserver callback corrects the width.
  if (availableWidth === 0) {
    const selectWidthPx = isBranchMode
      ? measureTextWidth(selectedBranch ?? "", MONO_12PX) + SELECT_PADDING_PX + SELECT_CHEVRON_PX
      : 0;
    return {
      ...LAYOUT_CONFIGS[0],
      configIndex: 0,
      selectWidthPx,
      requiredWidthPx: 0,
      fitsAvailableWidth: true,
    };
  }

  const prTitleWidth = pr?.title ? measureTextWidth(pr.title, MONO_11PX) : null;
  const prMinWidth = pr ? badgeMinWidth(pr.number, pr.state) : 0;
  const prFullWidth =
    pr && prTitleWidth !== null ? badgeFullWidth(pr.number, pr.state, prTitleWidth) : prMinWidth;

  const naturalSelectWidth = branchSelectNaturalWidth(selectedBranch);
  const branchMinWidth = isBranchMode
    ? branchAreaWidth(DIFF_VIEWER_BRANCH_SELECT_MIN_WIDTH_PX, false)
    : 0;
  const branchFullWidth = isBranchMode
    ? branchAreaWidth(DIFF_VIEWER_BRANCH_SELECT_MIN_WIDTH_PX, true)
    : 0;

  const statMin = statsMinWidth(additions, deletions);
  const statFull = statsFullWidth(additions, deletions, binaryCount);

  const prevIndex = previousConfigIndex ?? 0;

  const buildResult = (config: HeaderLayout, configIndex: number): HeaderLayoutResult => {
    const minimumRequiredWidth = computeConfigWidth(
      config,
      isBranchMode,
      branchMinWidth,
      branchFullWidth,
      Boolean(pr),
      prMinWidth,
      prFullWidth,
      statMin,
      statFull,
      isLoading,
    );
    const selectWidthPx = isBranchMode
      ? Math.min(
          naturalSelectWidth,
          DIFF_VIEWER_BRANCH_SELECT_MIN_WIDTH_PX +
            Math.max(0, availableWidth - minimumRequiredWidth),
        )
      : 0;
    const selectedBranchMinWidth = isBranchMode ? branchAreaWidth(selectWidthPx, false) : 0;
    const selectedBranchFullWidth = isBranchMode ? branchAreaWidth(selectWidthPx, true) : 0;
    const requiredWidthPx = computeConfigWidth(
      config,
      isBranchMode,
      selectedBranchMinWidth,
      selectedBranchFullWidth,
      Boolean(pr),
      prMinWidth,
      prFullWidth,
      statMin,
      statFull,
      isLoading,
    );
    return {
      ...config,
      configIndex,
      selectWidthPx,
      requiredWidthPx,
      fitsAvailableWidth: requiredWidthPx <= availableWidth,
    };
  };

  for (let index = 0; index < LAYOUT_CONFIGS.length; index++) {
    const config = LAYOUT_CONFIGS[index];
    const configWidth = computeConfigWidth(
      config,
      isBranchMode,
      branchMinWidth,
      branchFullWidth,
      Boolean(pr),
      prMinWidth,
      prFullWidth,
      statMin,
      statFull,
      isLoading,
    );

    if (configWidth <= availableWidth) {
      // Hysteresis: when shrinking, switch freely. When growing, stay in the
      // previous (more compact) config until there's enough margin.
      if (index >= prevIndex) {
        return buildResult(config, index);
      }
      const prevConfig = LAYOUT_CONFIGS[prevIndex];
      const prevConfigWidth = computeConfigWidth(
        prevConfig,
        isBranchMode,
        branchMinWidth,
        branchFullWidth,
        Boolean(pr),
        prMinWidth,
        prFullWidth,
        statMin,
        statFull,
        isLoading,
      );
      if (availableWidth >= prevConfigWidth + HYSTERESIS_PX) {
        return buildResult(config, index);
      }
      return buildResult(prevConfig, prevIndex);
    }
  }

  const last = LAYOUT_CONFIGS[LAYOUT_CONFIGS.length - 1];
  return buildResult(last, LAYOUT_CONFIGS.length - 1);
};
