import type { z } from "zod";
import type { serverToClientMessageSchema } from "@monotykamary/localterm-server/protocol";

/**
 * Shape of the live shell session metadata pushed by the server on WS connect.
 *
 * Derived from the server's `serverToClientMessageSchema` so the client never
 * drifts from the protocol — adding a field on the server adds it here for
 * free, and `Omit<..., "type">` drops the discriminator that callers don't
 * carry around in component state.
 */
export type TerminalSessionInfo = Omit<
  Extract<z.infer<typeof serverToClientMessageSchema>, { type: "session" }>,
  "type"
>;
