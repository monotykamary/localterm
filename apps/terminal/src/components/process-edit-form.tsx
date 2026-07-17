import type { SecretEntryResponse } from "@monotykamary/localterm-server/protocol";
import { SecretSelector } from "@/components/secret-selector";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ProcessEditFormState } from "@/hooks/use-process-actions";

interface ProcessEditFormProps {
  form: ProcessEditFormState;
  error: string | null;
  isSaving: boolean;
  secrets: SecretEntryResponse[];
  onChange: (form: ProcessEditFormState) => void;
  onCancel: () => void;
  onSave: () => void;
}

export const ProcessEditForm = ({
  form,
  error,
  isSaving,
  secrets,
  onChange,
  onCancel,
  onSave,
}: ProcessEditFormProps) => {
  const isEditing = form.originalName !== null;

  return (
    <div className="m-1.5 rounded-sm border border-border/40 bg-muted/20 p-2.5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
            Binary name
          </label>
          {isEditing ? (
            <div className="flex h-7 items-center px-2 font-mono text-xs text-foreground">
              {form.originalName}
            </div>
          ) : (
            <Input
              value={form.name}
              autoFocus
              name="localterm-process-name"
              autoComplete="off"
              placeholder="pi"
              aria-label="process binary name"
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              className="h-7 px-2 font-mono text-xs"
            />
          )}
          {isEditing ? (
            <span className="text-[10px] text-muted-foreground/50">
              Can't rename a process — delete and recreate to change its name.
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/50">
              The binary the shim shadows (one name, e.g. pi or claude).
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
            Secrets to expose
          </span>
          {secrets.length === 0 ? (
            <span className="text-[10px] text-muted-foreground/60">
              No secrets configured. Add one on the Secrets tab first.
            </span>
          ) : (
            <SecretSelector
              selected={form.requestedSecrets}
              options={secrets}
              onChange={(requestedSecrets) => onChange({ ...form, requestedSecrets })}
            />
          )}
        </div>
        {error ? <div className="text-[11px] text-red-500 dark:text-red-400">{error}</div> : null}
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Button variant="ghost" size="xs" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="xs" onClick={onSave} disabled={isSaving}>
            {isSaving ? <Spinner className="size-3.5" /> : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
};
