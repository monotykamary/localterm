import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { SecretExportFormState } from "@/hooks/use-secret-transfer-actions";

interface SecretExportFormProps {
  form: SecretExportFormState;
  error: string | null;
  isExporting: boolean;
  onChange: (form: SecretExportFormState) => void;
  onCancel: () => void;
  onExport: () => void;
}

export const SecretExportForm = ({
  form,
  error,
  isExporting,
  onChange,
  onCancel,
  onExport,
}: SecretExportFormProps) => (
  <div className="m-1.5 rounded-sm border border-border/40 bg-muted/20 p-2.5">
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="localterm-secret-export-passphrase"
          className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase"
        >
          Passphrase
        </label>
        <Input
          id="localterm-secret-export-passphrase"
          type="password"
          value={form.passphrase}
          autoFocus
          autoComplete="new-password"
          aria-label="export passphrase"
          onChange={(event) => onChange({ ...form, passphrase: event.target.value })}
          className="h-7 px-2 font-mono text-xs"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="localterm-secret-export-confirm"
          className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase"
        >
          Confirm passphrase
        </label>
        <Input
          id="localterm-secret-export-confirm"
          type="password"
          value={form.confirm}
          autoComplete="new-password"
          aria-label="confirm export passphrase"
          onChange={(event) => onChange({ ...form, confirm: event.target.value })}
          className="h-7 px-2 font-mono text-xs"
        />
      </div>
      <div className="text-[10px] leading-relaxed text-muted-foreground/60">
        Encrypts every secret's value into an age file. Keep the passphrase — it can't be recovered.
        The file also decrypts with the stock `age` CLI.
      </div>
      {error ? <div className="text-[11px] text-red-500 dark:text-red-400">{error}</div> : null}
      <div className="flex items-center justify-end gap-1.5 pt-1">
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={isExporting}>
          Cancel
        </Button>
        <Button size="xs" onClick={onExport} disabled={isExporting}>
          {isExporting ? <Spinner className="size-3.5" /> : "Export"}
        </Button>
      </div>
    </div>
  </div>
);
