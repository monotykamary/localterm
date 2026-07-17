import type { ChangeEvent, RefObject } from "react";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { SettingsSelect, type SettingsSelectItem } from "@/components/settings-select";
import { SETTINGS_SECTION_LABEL_CLASSES } from "@/components/settings-section-styles";
import { AUTO_THEME_ID, TERMINAL_THEMES, type TerminalTheme } from "@/lib/terminal-themes";

export interface ThemeSettingsSectionProps {
  themeId: string;
  onThemeChange: (themeId: string) => void;
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
  onThemeChange,
  onThemePreview,
  customThemes,
  onDeleteTheme,
  importError,
  importInputRef,
  onImportFile,
}: ThemeSettingsSectionProps) => {
  // Theme picker: the "Auto (system)" entry first (resolves to dark/light from
  // prefers-color-scheme), then the built-ins, then any user-imported custom
  // themes so they appear at the bottom with their original names.
  const themeItems: readonly SettingsSelectItem[] = [
    { id: AUTO_THEME_ID, label: "Auto (system)" },
    ...THEME_ITEMS,
    ...customThemes.map((theme) => ({ id: theme.id, label: theme.name })),
  ];
  const activeCustomTheme = customThemes.find((theme) => theme.id === themeId);

  const handleThemeChange = (nextThemeId: string | null) => {
    if (nextThemeId) onThemeChange(nextThemeId);
  };

  const handleThemeSelectOpenChange = (open: boolean) => {
    if (!open) onThemePreview?.(null);
  };

  return (
    <Field orientation="vertical" className="gap-1.5">
      <FieldLabel className={SETTINGS_SECTION_LABEL_CLASSES}>Theme</FieldLabel>
      <SettingsSelect
        value={themeId}
        items={themeItems}
        ariaLabel="select theme"
        placeholder="Theme"
        onValueChange={handleThemeChange}
        onOpenChange={handleThemeSelectOpenChange}
        onItemHover={onThemePreview ? (id) => onThemePreview(id) : undefined}
      />
      <input
        ref={importInputRef}
        type="file"
        accept=".json,.itermcolors,application/json,text/xml,application/xml"
        className="hidden"
        onChange={onImportFile}
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="xs"
          aria-label="import theme"
          onClick={() => importInputRef.current?.click()}
        >
          <Upload className="size-3" />
          Import theme…
        </Button>
        {activeCustomTheme ? (
          <Button
            variant="ghost"
            size="xs"
            aria-label="delete custom theme"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onDeleteTheme(activeCustomTheme.id)}
          >
            <Trash2 className="size-3" />
            Delete
          </Button>
        ) : null}
      </div>
      {importError ? (
        <span className="min-w-0 text-[10px] leading-tight text-amber-400">{importError}</span>
      ) : null}
    </Field>
  );
};
