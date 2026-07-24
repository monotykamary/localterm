import kleur from "kleur";
import { fetchSessionApi } from "./session-api.js";

interface SessionIdListItem {
  id: string;
}

interface SessionIdListResponse {
  sessions: SessionIdListItem[];
}

export const resolveSessionId = async (idOrPrefix: string): Promise<string | null> => {
  const response = await fetchSessionApi("/sessions", {});
  if (!response) return null;

  const { sessions } = (await response.json()) as SessionIdListResponse;
  const exactSession = sessions.find((session) => session.id === idOrPrefix);
  if (exactSession) return exactSession.id;

  const matchingSessions = sessions.filter((session) => session.id.startsWith(idOrPrefix));
  if (matchingSessions.length === 1) return matchingSessions[0].id;

  if (matchingSessions.length === 0) {
    console.log(kleur.red(`✗ no live session matches ${idOrPrefix}`));
  } else {
    console.log(kleur.red(`✗ session id ${idOrPrefix} is ambiguous`));
    for (const session of matchingSessions) console.log(kleur.dim(`  ${session.id}`));
  }
  process.exitCode = 1;
  return null;
};
