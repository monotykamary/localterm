import type { AgentModelInfo } from "@monotykamary/localterm-server/protocol";
import { agentModelId } from "@/utils/agent-model-id";
import { fuzzyMatch } from "@/utils/fuzzy-match";

// Collapse non-alphanumeric runs to a single space so separators become
// interchangeable: "short flex" matches "short-flex", "claude haiku" matches
// "Claude Haiku 4.5". Lowercasing first keeps the range ASCII-only.
const normalizeForSearch = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Best fuzzy score for a model against the query, matching both its
// provider/id and its display name. Higher scores rank better (contiguous,
// word-boundary hits beat scattered subsequences); null means no match.
const scoreAgentModel = (
  model: AgentModelInfo,
  normalizedQuery: string,
): number | null => {
  const idMatch = fuzzyMatch(normalizedQuery, normalizeForSearch(agentModelId(model)));
  const nameMatch = fuzzyMatch(normalizedQuery, normalizeForSearch(model.name));
  if (idMatch && nameMatch) return Math.max(idMatch.score, nameMatch.score);
  if (idMatch) return idMatch.score;
  if (nameMatch) return nameMatch.score;
  return null;
};

// Filter and rank the agent model list by fuzzy relevance to `query`. An empty
// query returns every model in server order (unranked); otherwise matching
// models come back best-first.
export const matchAgentModels = (
  models: readonly AgentModelInfo[],
  query: string,
): AgentModelInfo[] => {
  const normalizedQuery = normalizeForSearch(query);
  if (normalizedQuery.length === 0) return [...models];
  const scored: { model: AgentModelInfo; score: number }[] = [];
  for (const model of models) {
    const score = scoreAgentModel(model, normalizedQuery);
    if (score !== null) scored.push({ model, score });
  }
  scored.sort((first, second) => second.score - first.score);
  return scored.map(({ model }) => model);
};
