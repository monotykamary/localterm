import { PASTED_IMAGE_UPLOAD_TIMEOUT_MS } from "@/lib/constants";
import { SESSION_ID_QUERY_PARAM } from "@/utils/sync-session-id-query-param";

const UPLOAD_IMAGE_ENDPOINT = "/api/upload-image";

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  invalid_body: "Couldn't read the image",
  invalid_session: "Session ended",
  too_large: "Image too large",
  unsupported_type: "Unsupported image type",
  write_failed: "Couldn't save the image",
};

interface UploadPastedImageOptions {
  signal?: AbortSignal;
}

// Posts one bounded image Blob to session-scoped temporary storage and returns
// the absolute path that the terminal can paste. A caller may cancel a stale
// upload; the internal deadline also guarantees that a stalled fetch settles
// instead of leaving the loading toast and Blob alive indefinitely.
export const uploadPastedImage = async (
  sessionId: string,
  blob: Blob,
  filename = "image",
  options: UploadPastedImageOptions = {},
): Promise<string> => {
  const url = new URL(UPLOAD_IMAGE_ENDPOINT, window.location.href);
  url.searchParams.set(SESSION_ID_QUERY_PARAM, sessionId);
  const form = new FormData();
  form.append("image", blob, filename);

  const requestController = new AbortController();
  let didTimeout = false;
  const abortRequest = () => requestController.abort();
  if (options.signal?.aborted) abortRequest();
  else options.signal?.addEventListener("abort", abortRequest, { once: true });
  const timeout = window.setTimeout(() => {
    didTimeout = true;
    requestController.abort();
  }, PASTED_IMAGE_UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      body: form,
      signal: requestController.signal,
    });
    if (!response.ok) {
      const responseBody: unknown = await response.json().catch(() => null);
      const errorCode =
        responseBody && typeof responseBody === "object"
          ? Reflect.get(responseBody, "error")
          : undefined;
      const message =
        typeof errorCode === "string"
          ? (UPLOAD_ERROR_MESSAGES[errorCode] ?? errorCode)
          : `Upload failed (${response.status})`;
      throw new Error(message);
    }
    const responseBody: unknown = await response.json();
    const absolutePath =
      responseBody && typeof responseBody === "object"
        ? Reflect.get(responseBody, "path")
        : undefined;
    if (typeof absolutePath !== "string" || !absolutePath) {
      throw new Error("Invalid upload response");
    }
    return absolutePath;
  } catch (error) {
    if (didTimeout) throw new Error("Image upload timed out");
    if (options.signal?.aborted) throw new Error("Image upload canceled");
    if (error instanceof Error) throw error;
    throw new Error("Upload failed");
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortRequest);
  }
};
