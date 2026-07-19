import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { SecretEditFormState } from "@/hooks/use-secret-actions";

interface SecretEditFormProps {
  form: SecretEditFormState;
  error: string | null;
  isSaving: boolean;
  onChange: (form: SecretEditFormState) => void;
  onCancel: () => void;
  onSave: () => void;
}

export const SecretEditForm = ({
  form,
  error,
  isSaving,
  onChange,
  onCancel,
  onSave,
}: SecretEditFormProps) => {
  const isEditing = form.originalName !== null;

  return (
    <div className="m-1.5 rounded-sm border border-border/40 bg-muted/20 p-2.5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          {isEditing ? (
            <span className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
              Name
            </span>
          ) : (
            <label
              htmlFor="localterm-secret-name"
              className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase"
            >
              Name
            </label>
          )}
          {isEditing ? (
            <div className="flex h-7 items-center px-2 font-mono text-xs text-foreground">
              {form.originalName}
            </div>
          ) : (
            <Input
              id="localterm-secret-name"
              value={form.name}
              name="localterm-secret-name"
              autoComplete="off"
              placeholder="auto from env var"
              aria-label="secret name"
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              className="h-7 px-2 font-mono text-xs"
            />
          )}
          {isEditing ? (
            <span className="text-[10px] text-muted-foreground/50">
              Can't rename a secret — delete and recreate to change its name.
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/50">
              Optional. Derived from the env var (e.g. ANTHROPIC_API_KEY → anthropic-api-key) if
              left blank.
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="localterm-secret-envvar"
            className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase"
          >
            Environment variable
          </label>
          <Input
            id="localterm-secret-envvar"
            value={form.envVar}
            autoFocus
            name="localterm-secret-envvar"
            autoComplete="off"
            placeholder="ANTHROPIC_API_KEY"
            aria-label="environment variable name"
            onChange={(event) => onChange({ ...form, envVar: event.target.value })}
            className="h-7 px-2 font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="localterm-secret-value"
            className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase"
          >
            {isEditing ? "New value (optional)" : "Value"}
          </label>
          <Input
            id="localterm-secret-value"
            type="password"
            value={form.value}
            name="localterm-secret-value"
            placeholder={isEditing ? "Leave blank to keep current" : ""}
            aria-label="secret value"
            autoComplete="new-password"
            onChange={(event) => onChange({ ...form, value: event.target.value })}
            className="h-7 px-2 font-mono text-xs"
          />
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
