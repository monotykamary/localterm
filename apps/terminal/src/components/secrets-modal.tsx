import { Download, Key, Plus, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ModalSearch } from "@/components/modal-search";
import { ProcessesPanel } from "@/components/processes-panel";
import { SecretsPanel } from "@/components/secrets-panel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useProcessActions } from "@/hooks/use-process-actions";
import { useSecretActions } from "@/hooks/use-secret-actions";
import { useSecretTransferActions } from "@/hooks/use-secret-transfer-actions";
import { useSecretsResources } from "@/hooks/use-secrets-resources";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import {
  SECRETS_BODY_MIN_HEIGHT_PX,
  SECRETS_MODAL_CLOSE_TRANSITION_MS,
  SECRETS_MODAL_MAX_HEIGHT_PX,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

interface SecretsModalProps {
  open: boolean;
  onClose: () => void;
}

type ModalTab = "secrets" | "processes";

interface ModalTabOption {
  value: ModalTab;
  label: string;
}

const MODAL_TAB_OPTIONS: ModalTabOption[] = [
  { value: "secrets", label: "Secrets" },
  { value: "processes", label: "Processes" },
];

export const SecretsModal = ({ open, onClose }: SecretsModalProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [tab, setTab] = useState<ModalTab>("secrets");
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resources = useSecretsResources(open);
  const secretActions = useSecretActions(resources.refresh);
  const transferActions = useSecretTransferActions(resources.refresh, secretActions.cancelForm);
  const processActions = useProcessActions(resources.refresh);

  // Mount/unmount + open/close animation mirrors the sessions/ports/worktrees
  // modals. The search field is focused on open so the terminal's textarea
  // releases focus before any field is interacted with — without this xterm
  // retains focus and steals keystrokes from the modal's inputs.
  useEffect(() => {
    if (open) {
      setMounted(true);
      secretActions.reset();
      transferActions.reset();
      processActions.reset();
      setSearch("");
      const frame = requestAnimationFrame(() => {
        setSettled(true);
        // Falls back to the panel when the search bar isn't rendered (error state).
        if (searchInputRef.current) searchInputRef.current.focus();
        else panelRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    secretActions.clearArmedDelete();
    transferActions.closeForms();
    processActions.clearArmedDelete();
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), SECRETS_MODAL_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open, mounted]);

  const secrets = resources.secrets ?? [];
  const filteredSecrets = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return secrets;
    return secrets.filter(
      (secret) =>
        secret.name.toLowerCase().includes(normalizedSearch) ||
        secret.envVar.toLowerCase().includes(normalizedSearch),
    );
  }, [secrets, search]);
  const filteredProcesses = useMemo(() => {
    if (!resources.processes) return [];
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return resources.processes;
    return resources.processes.filter(
      (process) =>
        process.name.toLowerCase().includes(normalizedSearch) ||
        process.requestedSecrets.some((secretName) =>
          secretName.toLowerCase().includes(normalizedSearch),
        ),
    );
  }, [resources.processes, search]);

  // Escape closes (capture phase, winning over the terminal's own handling
  // while the modal is up); a visible form on either tab cancels back to the
  // list first so an accidental esc doesn't drop unsaved edits silently.
  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (secretActions.form) secretActions.cancelForm();
      else if (transferActions.exportForm) transferActions.cancelExport();
      else if (transferActions.importForm) transferActions.cancelImport();
      else if (processActions.form) processActions.cancelForm();
      else onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    open,
    mounted,
    secretActions.form,
    transferActions.exportForm,
    transferActions.importForm,
    processActions.form,
    onClose,
  ]);

  const switchTab = (nextTab: ModalTab) => {
    setTab(nextTab);
    setSearch("");
    secretActions.reset();
    transferActions.reset();
    processActions.reset();
  };

  if (!mounted) return null;
  const isVisible = open && settled;
  const activeCount = tab === "secrets" ? resources.secrets?.length : resources.processes?.length;
  const activeFormOpen =
    tab === "secrets"
      ? secretActions.form !== null ||
        transferActions.exportForm !== null ||
        transferActions.importForm !== null
      : processActions.form !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
      <div
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(COMMAND_PALETTE_BACKDROP_CLASSES)}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="manage secrets and processes"
        aria-modal
        tabIndex={-1}
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(
          "relative z-10 flex w-[480px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl outline-none origin-top",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
        style={{ maxHeight: SECRETS_MODAL_MAX_HEIGHT_PX }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 py-2.5">
          <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-foreground">
            <Key className="size-4 text-muted-foreground" aria-hidden="true" />
            <div
              role="tablist"
              aria-label="secrets view"
              className="flex items-center rounded-md border border-border/60 p-0.5"
            >
              {MODAL_TAB_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => switchTab(value)}
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-xs transition-colors",
                    tab === value
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeCount === undefined && !resources.hasError ? (
              <Spinner className="size-3.5" aria-label="loading" />
            ) : (
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
                {activeCount ?? 0}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="close"
              className="hover:text-foreground"
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>

        <div
          ref={listScrollRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="animate-in fade-in-0 duration-150 ease-snappy">
            {!resources.hasError ? (
              <ModalSearch
                inputRef={searchInputRef}
                value={search}
                onChange={setSearch}
                placeholder={tab === "secrets" ? "Search secrets…" : "Search processes…"}
                ariaLabel={tab === "secrets" ? "search secrets" : "search processes"}
              />
            ) : null}
            {resources.hasError ? (
              <div
                className="flex flex-col items-center justify-center gap-3 px-2.5 py-6 text-center text-sm text-muted-foreground/70"
                style={{ minHeight: SECRETS_BODY_MIN_HEIGHT_PX }}
              >
                Couldn't load from the localterm daemon.
                <Button variant="outline" size="xs" onClick={() => void resources.refresh()}>
                  Retry
                </Button>
              </div>
            ) : tab === "secrets" ? (
              <SecretsPanel
                secrets={secrets}
                filteredSecrets={filteredSecrets}
                supported={resources.supported}
                search={search}
                listScrollRef={listScrollRef}
                secretForm={secretActions.form}
                secretFormError={secretActions.formError}
                isSecretSaving={secretActions.isSaving}
                secretDeletingName={secretActions.deletingName}
                secretArmedDeleteName={secretActions.armedDeleteName}
                exportForm={transferActions.exportForm}
                exportError={transferActions.exportError}
                isExporting={transferActions.isExporting}
                importForm={transferActions.importForm}
                importError={transferActions.importError}
                isImporting={transferActions.isImporting}
                onStartAdd={secretActions.startAdd}
                onStartEdit={secretActions.startEdit}
                onSecretFormChange={secretActions.updateForm}
                onCancelSecretForm={secretActions.cancelForm}
                onSaveSecret={() => void secretActions.save()}
                onSecretTrashClick={secretActions.handleTrashClick}
                onExportFormChange={transferActions.updateExportForm}
                onCancelExport={transferActions.cancelExport}
                onExport={() => void transferActions.exportAll()}
                onImportFormChange={transferActions.updateImportForm}
                onImportFile={(file) => void transferActions.handleImportFile(file)}
                onCancelImport={transferActions.cancelImport}
                onImport={() => void transferActions.importAll()}
              />
            ) : (
              <ProcessesPanel
                filteredProcesses={filteredProcesses}
                secrets={secrets}
                search={search}
                processForm={processActions.form}
                processFormError={processActions.formError}
                isProcessSaving={processActions.isSaving}
                processDeletingName={processActions.deletingName}
                processArmedDeleteName={processActions.armedDeleteName}
                onStartAdd={processActions.startAdd}
                onStartEdit={processActions.startEdit}
                onProcessFormChange={processActions.updateForm}
                onCancelProcessForm={processActions.cancelForm}
                onSaveProcess={() => void processActions.save()}
                onProcessTrashClick={processActions.handleTrashClick}
              />
            )}
          </div>
        </div>

        <div className="flex items-center border-t border-border/40 px-4 py-1.5 text-[10px] text-muted-foreground/60">
          {!resources.hasError && tab === "secrets" && resources.supported ? (
            <>
              <Button
                variant="ghost"
                size="xs"
                onClick={secretActions.startAdd}
                disabled={
                  secretActions.form !== null ||
                  transferActions.exportForm !== null ||
                  transferActions.importForm !== null
                }
                className="text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                New secret
              </Button>
              {resources.secrets?.some((secret) => secret.hasValue) ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={transferActions.startExport}
                  disabled={
                    secretActions.form !== null ||
                    transferActions.exportForm !== null ||
                    transferActions.importForm !== null ||
                    transferActions.isExporting
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  Export
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="xs"
                onClick={transferActions.startImport}
                disabled={
                  secretActions.form !== null ||
                  transferActions.exportForm !== null ||
                  transferActions.importForm !== null ||
                  transferActions.isImporting
                }
                className="text-muted-foreground hover:text-foreground"
              >
                <Upload className="size-3.5" aria-hidden="true" />
                Import
              </Button>
            </>
          ) : null}
          {!resources.hasError && tab === "processes" ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={processActions.startAdd}
              disabled={processActions.form !== null}
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New process
            </Button>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <kbd className="rounded border border-border/40 bg-muted/30 px-1 font-mono text-[10px]">
              esc
            </kbd>
            {activeFormOpen ? "cancel" : "close"}
          </span>
        </div>
      </div>
    </div>
  );
};
