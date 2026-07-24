import { useCallback, useState } from "react";
import { downloadTextFile } from "@/utils/download-text-file";
import { exportSecrets, importSecrets } from "@/utils/fetch-secrets";

export interface SecretExportFormState {
  passphrase: string;
  confirm: string;
}

export interface SecretImportFormState {
  passphrase: string;
  data: string | null;
  filename: string;
}

interface SecretTransferActions {
  exportForm: SecretExportFormState | null;
  exportError: string | null;
  isExporting: boolean;
  importForm: SecretImportFormState | null;
  importError: string | null;
  isImporting: boolean;
  startExport: () => void;
  startImport: () => void;
  updateExportForm: (form: SecretExportFormState) => void;
  updateImportForm: (form: SecretImportFormState) => void;
  cancelExport: () => void;
  cancelImport: () => void;
  handleImportFile: (file: File) => Promise<void>;
  importAll: () => Promise<void>;
  exportAll: () => Promise<void>;
  reset: () => void;
  closeForms: () => void;
}

export const useSecretTransferActions = (
  refresh: () => Promise<void>,
  cancelSecretForm: () => void,
): SecretTransferActions => {
  const [exportForm, setExportForm] = useState<SecretExportFormState | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [importForm, setImportForm] = useState<SecretImportFormState | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const startExport = () => {
    cancelSecretForm();
    setExportError(null);
    setImportForm(null);
    setImportError(null);
    setExportForm({ passphrase: "", confirm: "" });
  };

  const startImport = () => {
    cancelSecretForm();
    setExportForm(null);
    setExportError(null);
    setImportError(null);
    setImportForm({ passphrase: "", data: null, filename: "" });
  };

  const handleImportFile = async (file: File) => {
    if (!importForm) return;
    try {
      const data = await file.text();
      setImportForm({ ...importForm, data, filename: file.name });
      setImportError(null);
    } catch {
      setImportError("Couldn't read that file.");
    }
  };

  const importAll = async () => {
    if (!importForm) return;
    if (importForm.data === null) {
      setImportError("Choose an export file to import.");
      return;
    }
    if (!importForm.passphrase) {
      setImportError("Enter the passphrase for the export file.");
      return;
    }
    setIsImporting(true);
    setImportError(null);
    const result = await importSecrets(importForm.data, importForm.passphrase);
    setIsImporting(false);
    if (!result) {
      setImportError("Couldn't import — wrong passphrase, or the daemon is down.");
      return;
    }
    if (result.errors.length > 0) {
      setImportError(
        `Imported ${result.imported} (${result.created} new, ${result.updated} updated); ${result.errors.length} failed: ${result.errors
          .map((entry) => `${entry.name} (${entry.error})`)
          .join(", ")}.`,
      );
      void refresh();
      return;
    }
    setImportForm(null);
    void refresh();
  };

  const exportAll = async () => {
    if (!exportForm) return;
    const passphrase = exportForm.passphrase;
    if (!passphrase) {
      setExportError("Enter a passphrase for the export file.");
      return;
    }
    if (passphrase !== exportForm.confirm) {
      setExportError("Passphrases do not match.");
      return;
    }
    setIsExporting(true);
    setExportError(null);
    const result = await exportSecrets(passphrase);
    setIsExporting(false);
    if (!result) {
      setExportError("Couldn't export — the daemon may be down or secrets unsupported here.");
      return;
    }
    downloadTextFile("localterm-secrets.age", result.data);
    setExportForm(null);
  };

  const cancelExport = useCallback(() => setExportForm(null), []);
  const cancelImport = useCallback(() => setImportForm(null), []);
  const reset = useCallback(() => {
    setExportForm(null);
    setExportError(null);
    setImportForm(null);
    setImportError(null);
  }, []);

  const closeForms = useCallback(() => {
    setExportForm(null);
    setImportForm(null);
  }, []);

  return {
    exportForm,
    exportError,
    isExporting,
    importForm,
    importError,
    isImporting,
    startExport,
    startImport,
    updateExportForm: setExportForm,
    updateImportForm: setImportForm,
    cancelExport,
    cancelImport,
    handleImportFile,
    importAll,
    exportAll,
    reset,
    closeForms,
  };
};
