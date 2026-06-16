import { prepareWithSegments, measureNaturalWidth } from "@chenglou/pretext";

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

const branchAreaMinWidth = (branchName: string | null): number =>
  ICON_14_PX +
  GAP_1_5_PX +
  measureTextWidth(branchName ?? "", MONO_12PX) +
  SELECT_PADDING_PX +
  SELECT_CHEVRON_PX;

const branchAreaFullWidth = (branchName: string | null): number =>
  S.vs + GAP_1_5_PX + branchAreaMinWidth(branchName);

export interface HeaderLayout {
  showTitle: boolean;
  compareLabels: "full" | "abbreviated";
  showVs: boolean;
  prShowTitle: boolean;
  layoutLabels: "full" | "abbreviated";
  showBinaryCount: boolean;
  showRefresh: boolean;
  headerGap: number;
  headerPadding: number;
}

export interface HeaderLayoutResult extends HeaderLayout {
  selectWidthPx: number;
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
  previousConfigIndex?: number;
}

const LAYOUT_CONFIGS: HeaderLayout[] = [
  {
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
    showTitle: true,
    compareLabels: "full",
    showVs: true,
    prShowTitle: true,
    layoutLabels: "abbreviated",
    showBinaryCount: true,
    showRefresh: true,
    headerGap: GAP_3_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    showTitle: true,
    compareLabels: "full",
    showVs: true,
    prShowTitle: false,
    layoutLabels: "abbreviated",
    showBinaryCount: true,
    showRefresh: true,
    headerGap: GAP_3_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    showTitle: true,
    compareLabels: "full",
    showVs: false,
    prShowTitle: false,
    layoutLabels: "abbreviated",
    showBinaryCount: true,
    showRefresh: true,
    headerGap: GAP_3_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    showTitle: true,
    compareLabels: "abbreviated",
    showVs: false,
    prShowTitle: false,
    layoutLabels: "abbreviated",
    showBinaryCount: false,
    showRefresh: true,
    headerGap: GAP_2_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    showTitle: false,
    compareLabels: "abbreviated",
    showVs: false,
    prShowTitle: false,
    layoutLabels: "abbreviated",
    showBinaryCount: false,
    showRefresh: true,
    headerGap: GAP_2_PX,
    headerPadding: HEADER_PAD_COMPACT_PX,
  },
  {
    showTitle: false,
    compareLabels: "abbreviated",
    showVs: false,
    prShowTitle: false,
    layoutLabels: "abbreviated",
    showBinaryCount: false,
    showRefresh: false,
    headerGap: GAP_2_PX,
    headerPadding: HEADER_PAD_COMPACT_PX,
  },
];

// The header is a flex row with gap-{N}:
//   [title?] [compare] [branch?] [pr?] [stats] [ml-auto div]
// The ml-auto div bundles [layout radio] [gap-1] [refresh] [gap-1] [close]
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
): number => {
  const leftElements: number[] = [];
  if (config.showTitle) leftElements.push(S.changesTitle);
  leftElements.push(config.compareLabels === "full" ? COMPARE_FULL_WIDTH : COMPARE_ABBR_WIDTH);
  if (isBranchMode) leftElements.push(config.showVs ? branchFullWidth : branchMinWidth);
  if (isPr) leftElements.push(config.prShowTitle ? prFullWidth : prMinWidth);
  leftElements.push(config.showBinaryCount ? statFull : statMin);

  const rightDiv = rightDivWidth(config.layoutLabels, config.showRefresh);

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
    previousConfigIndex,
  } = params;

  // Width unmeasured yet — return the fullest layout so nothing is hidden
  // before the first ResizeObserver callback corrects the width.
  if (availableWidth === 0) {
    const selectWidthPx = isBranchMode
      ? measureTextWidth(selectedBranch ?? "", MONO_12PX) + SELECT_PADDING_PX + SELECT_CHEVRON_PX
      : 0;
    return { ...LAYOUT_CONFIGS[0], configIndex: 0, selectWidthPx };
  }

  const prTitleWidth = pr?.title ? measureTextWidth(pr.title, MONO_11PX) : null;
  const prMinWidth = pr ? badgeMinWidth(pr.number, pr.state) : 0;
  const prFullWidth =
    pr && prTitleWidth !== null ? badgeFullWidth(pr.number, pr.state, prTitleWidth) : 0;

  const branchMinWidth = isBranchMode ? branchAreaMinWidth(selectedBranch) : 0;
  const branchFullWidth = isBranchMode ? branchAreaFullWidth(selectedBranch) : 0;

  const statMin = statsMinWidth(additions, deletions);
  const statFull = statsFullWidth(additions, deletions, binaryCount);

  const prevIndex = previousConfigIndex ?? 0;

  const selectWidthPx = isBranchMode
    ? measureTextWidth(selectedBranch ?? "", MONO_12PX) + SELECT_PADDING_PX + SELECT_CHEVRON_PX
    : 0;

  for (let i = 0; i < LAYOUT_CONFIGS.length; i++) {
    const config = LAYOUT_CONFIGS[i];
    const configWidth = computeConfigWidth(
      config,
      isBranchMode,
      branchMinWidth,
      branchFullWidth,
      !!pr,
      prMinWidth,
      prFullWidth,
      statMin,
      statFull,
    );

    if (configWidth <= availableWidth) {
      // Hysteresis: when shrinking, switch freely. When growing, stay in the
      // previous (more compact) config until there's enough margin.
      if (i >= prevIndex) {
        return { ...config, configIndex: i, selectWidthPx };
      }
      const prevConfig = LAYOUT_CONFIGS[prevIndex];
      const prevConfigWidth = computeConfigWidth(
        prevConfig,
        isBranchMode,
        branchMinWidth,
        branchFullWidth,
        !!pr,
        prMinWidth,
        prFullWidth,
        statMin,
        statFull,
      );
      if (availableWidth >= prevConfigWidth + HYSTERESIS_PX) {
        return { ...config, configIndex: i, selectWidthPx };
      }
      return { ...prevConfig, configIndex: prevIndex, selectWidthPx };
    }
  }

  const last = LAYOUT_CONFIGS[LAYOUT_CONFIGS.length - 1];
  return { ...last, configIndex: LAYOUT_CONFIGS.length - 1, selectWidthPx };
};
