import type { Process } from "@monotykamary/localterm-server/protocol";
import { useCallback, useState } from "react";
import { MAX_PROCESS_REQUESTED_SECRETS } from "@/lib/constants";
import { deleteProcess, putProcess } from "@/utils/fetch-processes";

// A process's name is the shim filename and the identity the delete cascade
// keys on, so it is immutable: editing only changes requestedSecrets.
export interface ProcessEditFormState {
  originalName: string | null;
  name: string;
  requestedSecrets: string[];
}

interface ProcessActions {
  form: ProcessEditFormState | null;
  formError: string | null;
  isSaving: boolean;
  deletingName: string | null;
  armedDeleteName: string | null;
  startAdd: () => void;
  startEdit: (process: Process) => void;
  updateForm: (form: ProcessEditFormState) => void;
  cancelForm: () => void;
  save: () => Promise<void>;
  handleTrashClick: (name: string) => void;
  reset: () => void;
  clearArmedDelete: () => void;
}

// The daemon rejects a save for several distinct reasons; name each one so the
// user fixes the actual cause instead of guessing.
const PROCESS_SAVE_ERROR_TEXT: Record<string, string> = {
  invalid_name: "Enter a valid binary name (letters, numbers, . _ + -).",
  invalid_body: "The daemon rejected the request body.",
  invalid_secret: "A selected secret no longer exists. Deselect it and save again.",
  capacity: "The daemon's process limit is reached. Delete a process to add another.",
};
const PROCESS_SAVE_UNREACHABLE =
  "Couldn't save — the daemon didn't respond. Check that it's running.";

const describeProcessSaveError = (error: string | null): string =>
  error === null
    ? PROCESS_SAVE_UNREACHABLE
    : (PROCESS_SAVE_ERROR_TEXT[error] ?? PROCESS_SAVE_UNREACHABLE);

const EMPTY_PROCESS_FORM: ProcessEditFormState = {
  originalName: null,
  name: "",
  requestedSecrets: [],
};

export const useProcessActions = (refresh: () => Promise<void>): ProcessActions => {
  const [form, setForm] = useState<ProcessEditFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [armedDeleteName, setArmedDeleteName] = useState<string | null>(null);

  const startAdd = () => {
    setFormError(null);
    setForm({ ...EMPTY_PROCESS_FORM });
  };

  const startEdit = (process: Process) => {
    setFormError(null);
    setForm({
      originalName: process.name,
      name: process.name,
      requestedSecrets: [...process.requestedSecrets],
    });
  };

  const save = async () => {
    if (!form) return;
    const name = form.originalName ?? form.name.trim();
    if (!name) {
      setFormError("Enter a binary name (e.g. pi).");
      return;
    }
    if (form.requestedSecrets.length > MAX_PROCESS_REQUESTED_SECRETS) {
      setFormError(
        `A process can expose at most ${MAX_PROCESS_REQUESTED_SECRETS} secrets — deselect ${form.requestedSecrets.length - MAX_PROCESS_REQUESTED_SECRETS}.`,
      );
      return;
    }
    setIsSaving(true);
    setFormError(null);
    const result = await putProcess(name, form.requestedSecrets);
    setIsSaving(false);
    if (!result.ok) {
      setFormError(describeProcessSaveError(result.error));
      return;
    }
    setForm(null);
    void refresh();
  };

  const confirmDelete = async (name: string) => {
    setArmedDeleteName(null);
    setDeletingName(name);
    const didDelete = await deleteProcess(name);
    setDeletingName(null);
    if (didDelete) void refresh();
  };

  const handleTrashClick = (name: string) => {
    if (armedDeleteName !== name) {
      setArmedDeleteName(name);
      return;
    }
    void confirmDelete(name);
  };

  const cancelForm = useCallback(() => setForm(null), []);
  const reset = useCallback(() => {
    setForm(null);
    setFormError(null);
    setArmedDeleteName(null);
  }, []);
  const clearArmedDelete = useCallback(() => setArmedDeleteName(null), []);

  return {
    form,
    formError,
    isSaving,
    deletingName,
    armedDeleteName,
    startAdd,
    startEdit,
    updateForm: setForm,
    cancelForm,
    save,
    handleTrashClick,
    reset,
    clearArmedDelete,
  };
};
