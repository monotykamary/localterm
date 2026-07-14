import { SESSION_ID_QUERY_PARAM } from "@/utils/sync-session-id-query-param";

const UPLOAD_IMAGE_ENDPOINT = "/api/upload-image";

// POST a pasted or file-picked image blob to the daemon, which writes it into
// the session's ephemeral temp dir and returns the absolute path. The caller
// pastes that path (shell-quoted) into the prompt. Throws on a non-201 response
// so the caller can surface the failure — a slow mobile link can take a few
// seconds, and a silent no-op leaves the user wondering why the tap did nothing.
export const uploadPastedImage = async (
  sessionId: string,
  blob: Blob,
  filename?: string,
): Promise<string> => {
  const url = new URL(UPLOAD_IMAGE_ENDPOINT, window.location.href);
  url.searchParams.set(SESSION_ID_QUERY_PARAM, sessionId);
  const form = new FormData();
  form.append("image", blob, filename ?? "image");
  const response = await fetch(url.toString(), { method: "POST", body: form });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `upload failed (${response.status})`);
  }
  const body = (await response.json()) as { path: string };
  return body.path;
};
