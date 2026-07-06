import type { AgentModelInfo } from "@monotykamary/localterm-server/protocol";

// The string the model picker treats as a model's identifier: "provider/id"
// when a provider is set (pi's --model accepts this form), otherwise the bare
// id. Used both to display options and to match against the search query.
export const agentModelId = (model: AgentModelInfo): string =>
  model.provider.length > 0 ? `${model.provider}/${model.id}` : model.id;
