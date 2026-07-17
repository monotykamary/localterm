import { SESSION_SHORT_ID_LENGTH } from "../constants.js";

export const shortSessionId = (id: string): string => id.slice(0, SESSION_SHORT_ID_LENGTH);
