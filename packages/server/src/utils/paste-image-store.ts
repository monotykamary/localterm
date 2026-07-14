import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Ephemeral, session-scoped storage for pasted images: each session gets a
// directory under the OS temp root, reaped when the session is torn down (the
// tab closes, the shell exits, or the idle grace reaps it). A pasted image
// lives only as long as the session that received it — never written into the
// user's project tree.
const PASTE_IMAGE_DIR_ROOT = path.join(os.tmpdir(), "localterm-paste");

// Session ids are random UUIDs; restrict to a single path component so a
// crafted `?sid=../../etc` can't escape the paste root.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const isValidPasteSessionId = (sessionId: string): boolean =>
  SESSION_ID_PATTERN.test(sessionId);

export const pasteImageDirForSession = (sessionId: string): string =>
  path.join(PASTE_IMAGE_DIR_ROOT, sessionId);

export const writePastedImage = (
  sessionId: string,
  bytes: Uint8Array,
  extension: string,
): string => {
  const dir = pasteImageDirForSession(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `pasted-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  const absolutePath = path.join(dir, filename);
  fs.writeFileSync(absolutePath, bytes);
  return absolutePath;
};

export const deletePasteImagesForSession = (sessionId: string): void => {
  fs.rmSync(pasteImageDirForSession(sessionId), { recursive: true, force: true });
};
