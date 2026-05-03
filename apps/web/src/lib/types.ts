import type { z } from "zod";
import type { clientToServerMessageSchema } from "./schemas";

export type ClientToServerMessage = z.infer<typeof clientToServerMessageSchema>;
