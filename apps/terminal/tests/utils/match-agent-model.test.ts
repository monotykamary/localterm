import type { AgentModelInfo } from "@monotykamary/localterm-server/protocol";
import { describe, expect, it } from "vite-plus/test";
import { matchAgentModels } from "../../src/utils/match-agent-model";

const models: AgentModelInfo[] = [
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    contextWindow: 200000,
    reasoning: true,
  },
  { id: "glm-5.2", name: "GLM 5.2", provider: "makora" },
  { id: "gen-short-flex", name: "Auto Short Flex", provider: "earendil" },
];

describe("matchAgentModels", () => {
  it("matches across a space/hyphen separator mismatch (short flex -> short-flex)", () => {
    expect(matchAgentModels(models, "short flex").map((model) => model.id)).toEqual([
      "gen-short-flex",
    ]);
  });

  it("matches a hyphenated query literally (short-flex)", () => {
    expect(matchAgentModels(models, "short-flex").map((model) => model.id)).toEqual([
      "gen-short-flex",
    ]);
  });

  it("returns every model in server order for an empty query", () => {
    expect(matchAgentModels(models, "")).toEqual(models);
    expect(matchAgentModels(models, "   ")).toEqual(models);
  });

  it("returns nothing when no model matches", () => {
    expect(matchAgentModels(models, "zzzzzz")).toEqual([]);
  });

  it("matches a model by its display name", () => {
    expect(matchAgentModels(models, "haiku").map((model) => model.id)).toEqual([
      "claude-haiku-4-5",
    ]);
  });

  it("matches a model by its provider/id", () => {
    expect(matchAgentModels(models, "anthropic").map((model) => model.id)).toEqual([
      "claude-haiku-4-5",
    ]);
  });

  it("matches across the provider/id slash and a space", () => {
    expect(matchAgentModels(models, "makora glm").map((model) => model.id)).toEqual(["glm-5.2"]);
  });

  it("ranks a boundary/contiguous match above a contained interior match", () => {
    const ranked = matchAgentModels(
      [
        { id: "inflexible", name: "Inflexible", provider: "p2" },
        { id: "flex", name: "Flex", provider: "p1" },
      ],
      "flex",
    );
    expect(ranked.map((model) => model.id)).toEqual(["flex", "inflexible"]);
  });
});
