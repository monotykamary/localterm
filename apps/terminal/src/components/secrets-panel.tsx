import type { SecretEntryResponse } from "@monotykamary/localterm-server/protocol";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import type { CSSProperties, RefObject } from "react";
import { Plus } from "lucide-react";
import { SecretEditForm } from "@/components/secret-edit-form";
import { SecretExportForm } from "@/components/secret-export-form";
import { SecretImportForm } from "@/components/secret-import-form";
import { SecretRow } from "@/components/secret-row";
import { Button } from "@/components/ui/button";
import type { SecretEditFormState } from "@/hooks/use-secret-actions";
import type {
  SecretExportFormState,
  SecretImportFormState,
} from "@/hooks/use-secret-transfer-actions";
import {
  SECRETS_LIST_OVERSCAN_COUNT,
  SECRETS_LIST_ROW_HEIGHT_PX,
} from "@/lib/constants";

interface SecretsPanelProps {
  secrets: SecretEntryResponse[];
  filteredSecrets: SecretEntryResponse[];
  supported: boolean;
  search: string;
  listScrollRef: RefObject<HTMLDivElement | null>;
  secretForm: SecretEditFormState | null;
  secretFormError: string | null;
  isSecretSaving: boolean;
  secretDeletingName: string | null;
  secretArmedDeleteName: string | null;
  exportForm: SecretExportFormState | null;
  exportError: string | null;
  isExporting: boolean;
  importForm: SecretImportFormState | null;
  importError: string | null;
  isImporting: boolean;
  onStartAdd: () => void;
  onStartEdit: (secret: SecretEntryResponse) => void;
  onSecretFormChange: (form: SecretEditFormState) => void;
  onCancelSecretForm: () => void;
  onSaveSecret: () => void;
  onSecretTrashClick: (name: string) => void;
  onExportFormChange: (form: SecretExportFormState) => void;
  onCancelExport: () => void;
  onExport: () => void;
  onImportFormChange: (form: SecretImportFormState) => void;
  onImportFile: (file: File) => void;
  onCancelImport: () => void;
  onImport: () => void;
}

export const SecretsPanel = ({
  filteredSecrets,
  supported,
  search,
  listScrollRef,
  secretForm,
  secretFormError,
  isSecretSaving,
  secretDeletingName,
  secretArmedDeleteName,
  exportForm,
  exportError,
  isExporting,
  importForm,
  importError,
  isImporting,
  onStartAdd,
  onStartEdit,
  onSecretFormChange,
  onCancelSecretForm,
  onSaveSecret,
  onSecretTrashClick,
  onExportFormChange,
  onCancelExport,
  onExport,
  onImportFormChange,
  onImportFile,
  onCancelImport,
  onImport,
}: SecretsPanelProps) => {
  const virtualizer = useVirtualizer({
    count: filteredSecrets.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => SECRETS_LIST_ROW_HEIGHT_PX,
    overscan: SECRETS_LIST_OVERSCAN_COUNT,
    getItemKey: (index) => filteredSecrets[index].name,
  });
  // The list div gets an explicit pixel height (the virtualizer's total) so the
  // absolute-positioned rows have a sizing container; the intro/form/empty
  // state flow naturally above it inside the scroll element. No measurement
  // effect — getTotalSize() is read directly each render, so the body grows as
  // rows measure. Mirrors the worktrees modal (which never subtracted
  // scrollHeight - getTotalSize(); that earlier approach under-sized the body
  // on first open before rows measured, leaving only the first row visible).
  const secretListHeightPx = Math.max(
    SECRETS_LIST_ROW_HEIGHT_PX,
    virtualizer.getTotalSize(),
  );

  return (
    <>
      <div className="px-2.5 pb-2 pt-1 text-[11px] leading-relaxed text-muted-foreground/60">
        Stored in your macOS Keychain — never on disk. A secret is just a name + the env var it
        exports. Wire it to a binary on the Processes tab so only that program (via a PATH shim)
        ever sees the value.
      </div>

      {!supported ? (
        <div className="mx-2.5 mb-2 rounded-sm border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          Secret storage isn't supported on this server's platform (it uses macOS Keychain). Run
          the localterm daemon on a Mac to manage secrets here.
        </div>
      ) : null}

      {importForm ? (
        <SecretImportForm
          form={importForm}
          error={importError}
          isImporting={isImporting}
          onChange={onImportFormChange}
          onFile={onImportFile}
          onCancel={onCancelImport}
          onImport={onImport}
        />
      ) : null}

      {exportForm ? (
        <SecretExportForm
          form={exportForm}
          error={exportError}
          isExporting={isExporting}
          onChange={onExportFormChange}
          onCancel={onCancelExport}
          onExport={onExport}
        />
      ) : null}

      {secretForm ? (
        <SecretEditForm
          form={secretForm}
          error={secretFormError}
          isSaving={isSecretSaving}
          onChange={onSecretFormChange}
          onCancel={onCancelSecretForm}
          onSave={onSaveSecret}
        />
      ) : null}

      {filteredSecrets.length === 0 && !secretForm ? (
        <div className="flex flex-col items-center justify-center gap-2 px-2.5 py-6 text-center text-sm text-muted-foreground/70">
          {search.trim() ? (
            <span>No secrets match your search.</span>
          ) : (
            <>
              No secrets yet.
              {supported ? (
                <Button variant="outline" size="xs" onClick={onStartAdd}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  Add a secret
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {filteredSecrets.length > 0 ? (
        <div
          style={{
            height: `${secretListHeightPx}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow: VirtualItem) => {
            const secret = filteredSecrets[virtualRow.index];
            return (
              <div
                key={secret.name}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={
                  {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  } satisfies CSSProperties
                }
              >
                <SecretRow
                  secret={secret}
                  onEdit={() => onStartEdit(secret)}
                  onTrashClick={() => onSecretTrashClick(secret.name)}
                  isArmed={secretArmedDeleteName === secret.name}
                  isDeleting={secretDeletingName === secret.name}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
};
