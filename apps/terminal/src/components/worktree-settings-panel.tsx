import type {
  GitWorktreeBaseRef,
  WorktreeIncludeFile,
  WorktreeOpenInCommand,
  WorktreeRepoConfig,
} from "@monotykamary/localterm-server/protocol";
import { AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { WorktreeIncludeFileEditor } from "@/components/worktree-include-file-editor";
import { createWorktreeCommandId } from "@/utils/create-worktree-command-id";
import {
  updateWorktreeConfig,
  updateWorktreeIncludeFile,
} from "@/utils/fetch-git-worktrees";

interface WorktreeSettingsPanelProps {
  cwd: string | null;
  config: WorktreeRepoConfig | null;
  configError: boolean;
  includeFile: WorktreeIncludeFile | null;
  includeFileError: boolean;
  isRepo: boolean;
  onSaved: () => Promise<void>;
}

interface WorktreeBaseRefOption {
  value: GitWorktreeBaseRef;
  label: string;
  hint: string;
}

const BASE_REF_OPTIONS: ReadonlyArray<WorktreeBaseRefOption> = [
  { value: "fresh", label: "Remote default", hint: "origin/HEAD (fetches first)" },
  { value: "head", label: "Local HEAD", hint: "current branch + unpushed work" },
];

export const WorktreeSettingsPanel = ({
  cwd,
  config,
  configError,
  includeFile,
  includeFileError,
  isRepo,
  onSaved,
}: WorktreeSettingsPanelProps) => {
  const [baseRef, setBaseRef] = useState<GitWorktreeBaseRef>("fresh");
  const [setupScript, setSetupScript] = useState("");
  const [openInDrafts, setOpenInDrafts] = useState<WorktreeOpenInCommand[]>([]);
  const [includeContent, setIncludeContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [includeContentInitialized, setIncludeContentInitialized] = useState(false);

  // Seed the draft from the loaded config once (and re-seed if the repo changes
  // before the user has edited anything).
  useEffect(() => {
    if (!config || initialized) return;
    setBaseRef(config.baseRef);
    setSetupScript(config.setupScript);
    setOpenInDrafts(config.openInCommands.map((entry) => ({ ...entry })));
    setInitialized(true);
  }, [config, initialized]);

  useEffect(() => {
    if (!includeFile || includeContentInitialized) return;
    setIncludeContent(includeFile.content);
    setIncludeContentInitialized(true);
  }, [includeFile, includeContentInitialized]);

  if (configError) {
    return (
      <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <AlertTriangle className="size-4" aria-hidden="true" />
        Couldn't load worktree settings from the localterm daemon.
      </div>
    );
  }
  if (!config) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center">
        <Spinner aria-label="loading worktree settings" />
      </div>
    );
  }

  const addOpenIn = () =>
    setOpenInDrafts((drafts) => [
      ...drafts,
      { id: createWorktreeCommandId(), label: "", command: "" },
    ]);

  const updateOpenIn = (id: string, patch: Partial<WorktreeOpenInCommand>) =>
    setOpenInDrafts((drafts) =>
      drafts.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );

  const removeOpenIn = (id: string) =>
    setOpenInDrafts((drafts) => drafts.filter((entry) => entry.id !== id));

  const handleSave = async () => {
    if (!cwd) return;
    setIsSaving(true);
    setSaveError(null);
    const cleaned = openInDrafts
      .map((entry) => ({
        id: entry.id,
        label: entry.label.trim(),
        command: entry.command.trim(),
      }))
      .filter((entry) => entry.label && entry.command);
    const shouldUpdateIncludeFile =
      isRepo && (includeFile !== null || includeContent.trim() !== "");
    const [updatedConfig, updatedIncludeFile] = await Promise.all([
      updateWorktreeConfig(cwd, {
        baseRef,
        setupScript,
        openInCommands: cleaned,
      }),
      shouldUpdateIncludeFile
        ? updateWorktreeIncludeFile(cwd, includeContent)
        : Promise.resolve(includeFile),
    ]);
    setIsSaving(false);
    if (!updatedConfig || (shouldUpdateIncludeFile && !updatedIncludeFile)) {
      setSaveError("couldn't save settings");
      return;
    }
    setInitialized(false);
    setIncludeContentInitialized(false);
    await onSaved();
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="worktree-base-ref" className="text-xs font-medium text-foreground">
            Base ref
          </label>
          <select
            id="worktree-base-ref"
            value={baseRef}
            onChange={(event) => {
              const selectedBaseRef = BASE_REF_OPTIONS.find(
                (option) => option.value === event.target.value,
              )?.value;
              if (selectedBaseRef) setBaseRef(selectedBaseRef);
            }}
            className="h-7 rounded border border-border/60 bg-background px-2 text-xs text-foreground outline-none focus:border-foreground/40"
          >
            {BASE_REF_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} — {option.hint}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">
            New worktrees branch from this ref. Override per create with a PR number.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="worktree-setup-script" className="text-xs font-medium text-foreground">
            Setup script
          </label>
          <Textarea
            id="worktree-setup-script"
            value={setupScript}
            onChange={(event) => setSetupScript(event.target.value)}
            placeholder="pnpm install && cp .env.example .env"
            rows={3}
            className="text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            Run as the new worktree's first command when you create + open one, so env copy,
            installs, and db migration run visibly in the right shell.
          </p>
        </div>

        {isRepo ? (
          includeFileError ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">.worktreeinclude</span>
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Couldn't load .worktreeinclude from the localterm daemon.
              </div>
            </div>
          ) : includeFile ? (
            <WorktreeIncludeFileEditor
              includeFile={includeFile}
              value={includeContent}
              onChange={setIncludeContent}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">.worktreeinclude</span>
              <div className="flex h-20 items-center justify-center rounded border border-dashed border-border/60">
                <Spinner className="size-4" aria-label="loading .worktreeinclude" />
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">.worktreeinclude</span>
            <p className="text-[10px] text-muted-foreground">
              Only available inside a git repository.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Open in…</span>
            <Button variant="ghost" size="xs" onClick={addOpenIn} className="gap-1">
              <Plus className="size-3" aria-hidden="true" /> Add
            </Button>
          </div>
          {openInDrafts.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              No launchers. Add one like {`“code .”`} or {`“fork .”`} to open a worktree in an
              external app.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {openInDrafts.map((entry) => (
                <div key={entry.id} className="flex items-center gap-1.5">
                  <Input
                    value={entry.label}
                    onChange={(event) => updateOpenIn(entry.id, { label: event.target.value })}
                    placeholder="label (e.g. VS Code)"
                    className="h-6 w-32 text-xs"
                    aria-label="open in label"
                  />
                  <Input
                    value={entry.command}
                    onChange={(event) => updateOpenIn(entry.id, { command: event.target.value })}
                    placeholder="command (e.g. code .)"
                    className="h-6 flex-1 text-xs"
                    aria-label="open in command"
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="remove launcher"
                    onClick={() => removeOpenIn(entry.id)}
                    className="hover:text-foreground"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {saveError ? (
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            {saveError}
          </div>
        ) : null}
        <div className="flex justify-end gap-1.5">
          <Button variant="default" size="xs" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? (
              <Spinner className="size-3" aria-label="saving" />
            ) : (
              <Save className="size-3" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};
