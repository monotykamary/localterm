import { prepareWithSegments, measureNaturalWidth } from "@chenglou/pretext";

const SANS_12PX = "12px system-ui, -apple-system, sans-serif";
const SANS_MEDIUM_14PX = "500 14px system-ui, -apple-system, sans-serif";

const RADIO_H_CHROME_PX = 6;
const BTN_H_PAD_PX = 16;
const ICON_14_PX = 14;
const GAP_1_PX = 4;
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
  automations: measureTextWidth("Automations", SANS_MEDIUM_14PX),
  tabAutomations: measureTextWidth("Automations", SANS_12PX),
  recentRuns: measureTextWidth("Recent runs", SANS_12PX),
  a: measureTextWidth("A", SANS_12PX),
  r: measureTextWidth("R", SANS_12PX),
};

const radioGroupWidth = (label1Width: number, label2Width: number): number =>
  RADIO_H_CHROME_PX + (label1Width + BTN_H_PAD_PX) + (label2Width + BTN_H_PAD_PX);

const TABS_FULL_WIDTH = radioGroupWidth(S.tabAutomations, S.recentRuns);
const TABS_ABBR_WIDTH = radioGroupWidth(S.a, S.r);

const RIGHT_DIV_INTERNAL_GAP = GAP_1_PX;

interface LayoutConfig {
  showIcon: boolean;
  showTitle: boolean;
  tabLabels: "full" | "abbreviated";
  headerGap: number;
  headerPadding: number;
}

const LAYOUT_CONFIGS: LayoutConfig[] = [
  {
    showIcon: true,
    showTitle: true,
    tabLabels: "full",
    headerGap: GAP_3_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    showIcon: true,
    showTitle: true,
    tabLabels: "abbreviated",
    headerGap: GAP_3_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    showIcon: true,
    showTitle: false,
    tabLabels: "abbreviated",
    headerGap: GAP_2_PX,
    headerPadding: HEADER_PAD_FULL_PX,
  },
  {
    showIcon: false,
    showTitle: false,
    tabLabels: "abbreviated",
    headerGap: GAP_2_PX,
    headerPadding: HEADER_PAD_COMPACT_PX,
  },
];

const computeConfigWidth = (config: LayoutConfig, showCreateButton: boolean): number => {
  const leftElements: number[] = [];
  if (config.showIcon) leftElements.push(ICON_14_PX);
  if (config.showTitle) leftElements.push(S.automations);
  leftElements.push(config.tabLabels === "full" ? TABS_FULL_WIDTH : TABS_ABBR_WIDTH);

  const rightDiv = showCreateButton
    ? BUTTON_ICON_SM_PX + RIGHT_DIV_INTERNAL_GAP + BUTTON_ICON_SM_PX
    : BUTTON_ICON_SM_PX;

  const leftCount = leftElements.length;
  const leftContent = leftElements.reduce((sum, width) => sum + width, 0);
  const gapsWidth = leftCount * config.headerGap;

  return leftContent + rightDiv + gapsWidth + config.headerPadding + SAFETY_MARGIN_PX;
};

export interface AutomationsHeaderLayout {
  showIcon: boolean;
  showTitle: boolean;
  tabLabels: "full" | "abbreviated";
  headerGap: number;
  headerPadding: number;
}

export interface AutomationsHeaderLayoutResult extends AutomationsHeaderLayout {
  configIndex: number;
}

export interface AutomationsHeaderLayoutParams {
  availableWidth: number;
  showCreateButton: boolean;
  previousConfigIndex?: number;
}

export const computeAutomationsHeaderLayout = (
  params: AutomationsHeaderLayoutParams,
): AutomationsHeaderLayoutResult => {
  const { availableWidth, showCreateButton, previousConfigIndex } = params;

  if (availableWidth === 0) {
    return { ...LAYOUT_CONFIGS[0], configIndex: 0 };
  }

  const prevIndex = previousConfigIndex ?? 0;

  for (let index = 0; index < LAYOUT_CONFIGS.length; index++) {
    const config = LAYOUT_CONFIGS[index];
    const configWidth = computeConfigWidth(config, showCreateButton);

    if (configWidth <= availableWidth) {
      if (index >= prevIndex) {
        return { ...config, configIndex: index };
      }
      const prevConfig = LAYOUT_CONFIGS[prevIndex];
      const prevConfigWidth = computeConfigWidth(prevConfig, showCreateButton);
      if (availableWidth >= prevConfigWidth + HYSTERESIS_PX) {
        return { ...config, configIndex: index };
      }
      return { ...prevConfig, configIndex: prevIndex };
    }
  }

  const last = LAYOUT_CONFIGS[LAYOUT_CONFIGS.length - 1];
  return { ...last, configIndex: LAYOUT_CONFIGS.length - 1 };
};
