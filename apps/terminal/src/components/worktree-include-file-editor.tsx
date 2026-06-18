import type { WorktreeIncludeFile } from "@monotykamary/localterm-server/protocol";
import { FileText } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface WorktreeIncludeFileEditorProps {
  includeFile: WorktreeIncludeFile | null;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const WorktreeIncludeFileEditor = ({
  includeFile,
  value,
  onChange,
  disabled,
}: WorktreeIncludeFileEditorProps) => {
  const statusLabel = includeFile?.exists ? "exists" : "not created yet";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor="worktree-include-file"
          className="flex items-center gap-1.5 text-xs font-medium text-foreground"
        >
          <FileText className="size-3.5" aria-hidden="true" />
          .worktreeinclude
        </label>
        <span className="text-[10px] text-muted-foreground">{statusLabel}</span>
      </div>
      <Textarea
        id="worktree-include-file"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder=".env&#10;config/secrets.json"
        rows={5}
        disabled={disabled}
        className="font-mono text-xs"
      />
      <p className="text-[10px] text-muted-foreground">
        Gitignore-syntax patterns of gitignored files to copy from the main worktree into each new
        worktree. Tracked files are never copied. Save empty to remove the file.
      </p>
    </div>
  );
};
