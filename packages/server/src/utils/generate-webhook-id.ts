import { randomBytes } from "node:crypto";
import { WEBHOOK_ID_BYTES } from "../constants.js";

// Capability-URL token for a webhook trigger. Server-owned (generated at create,
// preserved across PATCHes that keep the webhook kind) and the only thing
// between an external POSTer and firing the automation, so it carries the full
// WEBHOOK_ID_BYTES of entropy. base64url keeps it a single url-safe path segment.
export const generateWebhookId = (): string => randomBytes(WEBHOOK_ID_BYTES).toString("base64url");
