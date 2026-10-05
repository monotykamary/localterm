import { prepareWithSegments, measureNaturalWidth } from "@chenglou/pretext";

const SANS_12PX = "12px system-ui, -apple-system, sans-serif";
const SANS_MEDIUM_14PX = "500 14px system-ui, -apple-system, sans-serif";
const RADIO_H_CHROME_PX = 6;
const BTN_H_PAD_PX = 16;
const ICON_PX = 16;
const GAP_1_PX = 4;
const GAP_3_PX = 12;
const BUTTON_ICON_SM_PX = 32;
const HEADER_PAD_FULL_PX = 32;
const SAFETY_MARGIN_PX = 4;
const HYSTERESIS_PX = 16;
const UNREAD_BADGE_RESERVE_PX = 32;

const measureTextWidth = (text: string, font: string): number => {
  try {
    return measureNaturalWidth(prepareWithSegments(text, font));
  } catch {
    return text.length * 6.8;
  }
};
const TITLE_WIDTH_PX = measureTextWidth("Automations", SANS_MEDIUM_14PX);
const TAB_LABELS = ["Automations", "Triage", "Upcoming"];
const TABS_WIDTH_PX =
  RADIO_H_CHROME_PX +
  TAB_LABELS.reduce(
    (width, label) => width + measureTextWidth(label, SANS_12PX) + BTN_H_PAD_PX,
    0,
  ) +
  UNREAD_BADGE_RESERVE_PX;

export interface AutomationsHeaderLayoutResult {
  tabsOnSecondRow: boolean;
  configIndex: number;
}
export interface AutomationsHeaderLayoutParams {
  availableWidth: number;
  showCreateButton: boolean;
  previousConfigIndex?: number;
}

export const computeAutomationsHeaderLayout = ({
  availableWidth,
  showCreateButton,
  previousConfigIndex = 0,
}: AutomationsHeaderLayoutParams): AutomationsHeaderLayoutResult => {
  const controlsWidth = BUTTON_ICON_SM_PX + (showCreateButton ? BUTTON_ICON_SM_PX + GAP_1_PX : 0);
  const fullWidth =
    TITLE_WIDTH_PX +
    ICON_PX +
    TABS_WIDTH_PX +
    controlsWidth +
    HEADER_PAD_FULL_PX +
    GAP_3_PX * 3 +
    SAFETY_MARGIN_PX;
  const tabsOnSecondRow =
    availableWidth > 0 &&
    availableWidth < fullWidth + (previousConfigIndex === 1 ? HYSTERESIS_PX : 0);
  return { tabsOnSecondRow, configIndex: tabsOnSecondRow ? 1 : 0 };
};
