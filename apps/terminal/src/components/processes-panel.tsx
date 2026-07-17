import type { Process, SecretEntryResponse } from "@monotykamary/localterm-server/protocol";
import { Plus } from "lucide-react";
import { ProcessEditForm } from "@/components/process-edit-form";
import { ProcessRow } from "@/components/process-row";
import { Button } from "@/components/ui/button";
import type { ProcessEditFormState } from "@/hooks/use-process-actions";

interface ProcessesPanelProps {
  filteredProcesses: Process[];
  secrets: SecretEntryResponse[];
  search: string;
  processForm: ProcessEditFormState | null;
  processFormError: string | null;
  isProcessSaving: boolean;
  processDeletingName: string | null;
  processArmedDeleteName: string | null;
  onStartAdd: () => void;
  onStartEdit: (process: Process) => void;
  onProcessFormChange: (form: ProcessEditFormState) => void;
  onCancelProcessForm: () => void;
  onSaveProcess: () => void;
  onProcessTrashClick: (name: string) => void;
}

export const ProcessesPanel = ({
  filteredProcesses,
  secrets,
  search,
  processForm,
  processFormError,
  isProcessSaving,
  processDeletingName,
  processArmedDeleteName,
  onStartAdd,
  onStartEdit,
  onProcessFormChange,
  onCancelProcessForm,
  onSaveProcess,
  onProcessTrashClick,
}: ProcessesPanelProps) => {
  const secretEnvVars = new Map(secrets.map((secret) => [secret.name, secret.envVar]));

  return (
    <>
      <div className="px-2.5 pb-2 pt-1 text-[11px] leading-relaxed text-muted-foreground/60">
        A process is a binary localterm wraps with a PATH shim. Select which secrets it receives;
        the shim resolves them from the Keychain and exports them only for that program.
      </div>

      {processForm ? (
        <ProcessEditForm
          form={processForm}
          error={processFormError}
          isSaving={isProcessSaving}
          secrets={secrets}
          onChange={onProcessFormChange}
          onCancel={onCancelProcessForm}
          onSave={onSaveProcess}
        />
      ) : null}

      {filteredProcesses.length === 0 && !processForm ? (
        <div className="flex flex-col items-center justify-center gap-2 px-2.5 py-6 text-center text-sm text-muted-foreground/70">
          {search.trim() ? (
            <span>No processes match your search.</span>
          ) : (
            <>
              No processes yet.
              <Button variant="outline" size="xs" onClick={onStartAdd}>
                <Plus className="size-3.5" aria-hidden="true" />
                Add a process
              </Button>
            </>
          )}
        </div>
      ) : null}
      {filteredProcesses.length > 0 ? (
        <div>
          {filteredProcesses.map((process) => (
            <ProcessRow
              key={process.name}
              process={process}
              secretEnvVars={secretEnvVars}
              onEdit={() => onStartEdit(process)}
              onTrashClick={() => onProcessTrashClick(process.name)}
              isArmed={processArmedDeleteName === process.name}
              isDeleting={processDeletingName === process.name}
            />
          ))}
        </div>
      ) : null}
    </>
  );
};
