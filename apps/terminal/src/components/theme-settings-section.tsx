import type { ChangeEvent, RefObject } from "react";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { SettingsSelect, type SettingsSelectItem } from "@/components/settings-select";
import {
  SETTINGS_ROW_LABEL_CLASSES,
  SETTINGS_SECTION_LABEL_CLASSES,
} from "@/components/settings-section-styles";
import { TERMINAL_THEMES, type TerminalTheme } from "@/lib/terminal-themes";

export interface ThemeSettingsSectionProps {
  themeId: string;
  lightThemeId: string;
  darkThemeId: string;
  systemThemeEnabled: boolean;
  onThemeChange: (themeId: string) => void;
  onLightThemeChange: (themeId: string) => void;
  onDarkThemeChange: (themeId: string) => void;
  onSystemThemeEnabledChange: (enabled: boolean) => void;
  onThemePreview?: (themeId: string | null) => void;
  customThemes: TerminalTheme[];
  onDeleteTheme: (id: string) => void;
  importError: string | null;
  importInputRef: RefObject<HTMLInputElement | null>;
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
}

const THEME_ITEMS: readonly SettingsSelectItem[] = TERMINAL_THEMES.map((theme) => ({
  id: theme.id,
  label: theme.name,
}));

export const ThemeSettingsSection = ({
  themeId,
  lightThemeId,
  darkThemeId,
  systemThemeEnabled,
  onThemeChange,
  onLightThemeChange,
  onDarkThemeChange,
  onSystemThemeEnabledChange,
  onThemePreview,
  customThemes,
  onDeleteTheme,
  importError,
  importInputRef,
  onImportFile,
}: ThemeSettingsSectionProps) => {
  const themeItems: readonly SettingsSelectItem[] = [
    ...THEME_ITEMS,
    ...customThemes.map((theme) => ({ id: theme.id, label: theme.name })),
  ];
  const selectedThemeIds = new Set(systemThemeEnabled ? [lightThemeId, darkThemeId] : [themeId]);
  const selectedCustomThemes = customThemes.filter((theme) => selectedThemeIds.has(theme.id));

  const handleThemeSelectOpenChange = (open: boolean) => {
    if (!open) onThemePreview?.(null);
  };

  const renderThemeSelect = (
    value: string,
    ariaLabel: string,
    onValueChange: (themeId: string) => void,
  ) => (
    <SettingsSelect
      value={value}
      items={themeItems}
      ariaLabel={ariaLabel}
      placeholder="Theme"
      onValueChange={(nextThemeId) => {
        if (nextThemeId) onValueChange(nextThemeId);
      }}
      onOpenChange={handleThemeSelectOpenChange}
      onItemHover={onThemePreview ? (id) => onThemePreview(id) : undefined}
    />
  );

  return (
    <Field orientation="vertical" className="gap-2">
      <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Theme</FieldLabel>
      <div className="flex items-center justify-between gap-2">
        <span className={SETTINGS_ROW_LABEL_CLASSES}>Use system appearance</span>
        <Switch
          aria-label="toggle system theme detection"
          checked={systemThemeEnabled}
          onCheckedChange={onSystemThemeEnabledChange}
        />
      </div>
      {systemThemeEnabled ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1">
            <span className={SETTINGS_ROW_LABEL_CLASSES}>Light theme</span>
            {renderThemeSelect(lightThemeId, "select light theme", onLightThemeChange)}
          </div>
          <div className="grid gap-1">
            <span className={SETTINGS_ROW_LABEL_CLASSES}>Dark theme</span>
            {renderThemeSelect(darkThemeId, "select dark theme", onDarkThemeChange)}
          </div>
        </div>
      ) : (
        renderThemeSelect(themeId, "select theme", onThemeChange)
      )}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,.itermcolors,application/json,text/xml,application/xml"
        className="hidden"
        onChange={onImportFile}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="xs"
          aria-label="import theme"
          onClick={() => importInputRef.current?.click()}
        >
          <Upload className="size-3" />
          Import theme…
        </Button>
        {selectedCustomThemes.map((theme) => (
          <Button
            key={theme.id}
            variant="ghost"
            size="xs"
            aria-label={`delete custom theme ${theme.name}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onDeleteTheme(theme.id)}
          >
            <Trash2 className="size-3" />
            Delete {selectedCustomThemes.length > 1 ? theme.name : ""}
          </Button>
        ))}
      </div>
      {importError ? (
        <span className="min-w-0 text-[10px] leading-tight text-amber-400">{importError}</span>
      ) : null}
    </Field>
  );
};
