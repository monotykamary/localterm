import { Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { SecretImportFormState } from "@/hooks/use-secret-transfer-actions";

interface SecretImportFormProps {
  form: SecretImportFormState;
  error: string | null;
  isImporting: boolean;
  onChange: (form: SecretImportFormState) => void;
  onFile: (file: File) => void;
  onCancel: () => void;
  onImport: () => void;
}

export const SecretImportForm = ({
  form,
  error,
  isImporting,
  onChange,
  onFile,
  onCancel,
  onImport,
}: SecretImportFormProps) => (
  <div className="m-1.5 rounded-sm border border-border/40 bg-muted/20 p-2.5">
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
          Export file
        </span>
        <label className="flex h-7 cursor-pointer items-center gap-2 rounded-sm border border-border/50 px-2 text-xs text-muted-foreground hover:text-foreground">
          <Upload className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{form.filename || "Choose file…"}</span>
          <input
            type="file"
            accept=".age,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="localterm-secret-import-passphrase"
          className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase"
        >
          Passphrase
        </label>
        <Input
          id="localterm-secret-import-passphrase"
          type="password"
          value={form.passphrase}
          autoComplete="current-password"
          aria-label="import passphrase"
          onChange={(event) => onChange({ ...form, passphrase: event.target.value })}
          className="h-7 px-2 font-mono text-xs"
        />
      </div>
      <div className="text-[10px] leading-relaxed text-muted-foreground/60">
        Decrypts an age export and upserts each secret. A secret with the same name is overwritten.
      </div>
      {error ? <div className="text-[11px] text-red-500 dark:text-red-400">{error}</div> : null}
      <div className="flex items-center justify-end gap-1.5 pt-1">
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={isImporting}>
          Cancel
        </Button>
        <Button size="xs" onClick={onImport} disabled={isImporting}>
          {isImporting ? <Spinner className="size-3.5" /> : "Import"}
        </Button>
      </div>
    </div>
  </div>
);
