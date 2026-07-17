import type { CSSProperties } from "react";
import { NumberStepper } from "@/components/number-stepper";
import { SettingsSelect, type SettingsSelectItem } from "@/components/settings-select";
import {
  SETTINGS_ROW_LABEL_CLASSES,
  SETTINGS_SECTION_LABEL_CLASSES,
} from "@/components/settings-section-styles";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  TERMINAL_FONT_SIZE_MAX_PX,
  TERMINAL_FONT_SIZE_MIN_PX,
  TERMINAL_FONT_SIZE_STEP_PX,
  TERMINAL_LINE_HEIGHT_MAX,
  TERMINAL_LINE_HEIGHT_MIN,
  TERMINAL_LINE_HEIGHT_STEP,
  TOOLTIP_SIDE_OFFSET_PX,
} from "@/lib/constants";
import { buildCustomTerminalFont, CUSTOM_FONT_ID, TERMINAL_FONTS } from "@/lib/terminal-fonts";

export interface FontSettingsSectionProps {
  fontId: string;
  onFontChange: (fontId: string) => void;
  onFontPreview?: (fontId: string | null) => void;
  customFontFamily: string;
  onCustomFontFamilyChange: (family: string) => void;
  nerdFontEnabled: boolean;
  onNerdFontEnabledChange: (enabled: boolean) => void;
  ligaturesEnabled: boolean;
  onLigaturesEnabledChange: (enabled: boolean) => void;
  muteEmojiColors: boolean;
  onMuteEmojiColorsChange: (muted: boolean) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  lineHeight: number;
  onLineHeightChange: (lineHeight: number) => void;
  isSelectOpen: boolean;
  onSelectOpenChange: (open: boolean) => void;
}

const FONT_ITEM_STYLE_BY_ID: Record<string, CSSProperties> = Object.fromEntries(
  TERMINAL_FONTS.map((font) => [font.id, { fontFamily: font.family }]),
);

const BUILTIN_FONT_ITEMS: readonly SettingsSelectItem[] = TERMINAL_FONTS.map((font) => ({
  id: font.id,
  label: font.name,
  itemStyle: FONT_ITEM_STYLE_BY_ID[font.id],
}));

const formatLineHeight = (value: number): string => value.toFixed(1);

export const FontSettingsSection = ({
  fontId,
  onFontChange,
  onFontPreview,
  customFontFamily,
  onCustomFontFamilyChange,
  nerdFontEnabled,
  onNerdFontEnabledChange,
  ligaturesEnabled,
  onLigaturesEnabledChange,
  muteEmojiColors,
  onMuteEmojiColorsChange,
  fontSize,
  onFontSizeChange,
  lineHeight,
  onLineHeightChange,
  isSelectOpen,
  onSelectOpenChange,
}: FontSettingsSectionProps) => {
  // The font picker appends a "Custom…" entry whose preview style uses the
  // user-entered family so the dropdown renders the item in that font (when
  // the OS resolves it). A blank custom family previews in the bundled default
  // (what an empty field falls back to) rather than a bare fallback chain.
  const customFont = buildCustomTerminalFont(customFontFamily);
  const fontItems: readonly SettingsSelectItem[] = [
    ...BUILTIN_FONT_ITEMS,
    { id: CUSTOM_FONT_ID, label: "Custom…", itemStyle: { fontFamily: customFont.family } },
  ];

  const handleFontChange = (nextFontId: string | null) => {
    if (nextFontId) onFontChange(nextFontId);
  };

  const handleFontSelectOpenChange = (open: boolean) => {
    onSelectOpenChange(open);
    if (!open) onFontPreview?.(null);
  };

  return (
    <Field orientation="vertical" className="gap-1.5">
      <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Font</FieldLabel>
      <SettingsSelect
        value={fontId}
        items={fontItems}
        ariaLabel="select font"
        placeholder="Font"
        open={isSelectOpen}
        onValueChange={handleFontChange}
        onOpenChange={handleFontSelectOpenChange}
        onItemHover={onFontPreview ? (id) => onFontPreview(id) : undefined}
      />
      {fontId === CUSTOM_FONT_ID ? (
        <Tooltip>
          <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
            Custom font family
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
            className="max-w-xs"
          >
            A font family installed on the host — most useful for a system-installed Nerd Font
            (e.g. “JetBrainsMono Nerd Font Mono”, “MesloLGS NF”) the browser resolves via
            fontconfig. Leave empty to fall back to the bundled default.
          </TooltipContent>
        </Tooltip>
      ) : null}
      {fontId === CUSTOM_FONT_ID ? (
        <Input
          value={customFontFamily}
          placeholder="e.g. JetBrainsMono Nerd Font Mono"
          aria-label="custom font family"
          className="h-7 px-2 font-mono text-xs"
          onChange={(event) => onCustomFontFamilyChange(event.target.value)}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className={SETTINGS_ROW_LABEL_CLASSES}>Size</span>
        <NumberStepper
          value={fontSize}
          min={TERMINAL_FONT_SIZE_MIN_PX}
          max={TERMINAL_FONT_SIZE_MAX_PX}
          step={TERMINAL_FONT_SIZE_STEP_PX}
          ariaLabel="terminal font size"
          decrementAriaLabel="decrease font size"
          incrementAriaLabel="increase font size"
          onValueChange={onFontSizeChange}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={SETTINGS_ROW_LABEL_CLASSES}>Line height</span>
        <NumberStepper
          value={lineHeight}
          min={TERMINAL_LINE_HEIGHT_MIN}
          max={TERMINAL_LINE_HEIGHT_MAX}
          step={TERMINAL_LINE_HEIGHT_STEP}
          ariaLabel="terminal line height"
          decrementAriaLabel="decrease line height"
          incrementAriaLabel="increase line height"
          formatDisplay={formatLineHeight}
          onValueChange={onLineHeightChange}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
            Nerd Font icons
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
            className="max-w-xs"
          >
            Appends a Symbols Only Nerd Font to the font stack. Icon glyphs (Private Use Area
            codepoints) are resolved by the symbols font while all other characters render from the
            primary font above.
          </TooltipContent>
        </Tooltip>
        <Switch
          aria-label="toggle nerd font icons"
          checked={nerdFontEnabled}
          onCheckedChange={onNerdFontEnabledChange}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
            Ligatures
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
            className="max-w-xs"
          >
            Fuses multi-character operators such as {"->"}, {"=>"}, and {"!=="} into single glyphs
            when the active font defines them (e.g. Fira Code, JetBrains Mono). Joins every run of
            operator characters so composable arrows like
            {"-->"} and {"===>"} shape at any length, plus letter pairs (fi, www) and hex/dimension
            literals (0xFF, 1920x1080) for full Fira Code parity. On fonts without ligatures this is
            a no-op and characters render exactly as before.
          </TooltipContent>
        </Tooltip>
        <Switch
          aria-label="toggle ligatures"
          checked={ligaturesEnabled}
          onCheckedChange={onLigaturesEnabledChange}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger render={<span className={SETTINGS_ROW_LABEL_CLASSES} />}>
            Mute emoji colors
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            sideOffset={TOOLTIP_SIDE_OFFSET_PX}
            className="max-w-xs"
          >
            Tints emoji with the surrounding terminal text color so they are less visually
            distracting. Turn this off to show their native colors.
          </TooltipContent>
        </Tooltip>
        <Switch
          aria-label="toggle mute emoji colors"
          checked={muteEmojiColors}
          onCheckedChange={onMuteEmojiColorsChange}
        />
      </div>
    </Field>
  );
};
