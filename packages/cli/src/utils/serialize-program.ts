import type { Command, Option } from "commander";
import { BUILTIN_FONT_IDS } from "@monotykamary/localterm-server/fonts";
import type {
  CommandSpec,
  CommandSpecNode,
  OptionSpec,
  PositionalSpec,
} from "@monotykamary/localterm-server/completion";

const IDENTITY_PROVIDERS = ["none", "header", "passkey", "oidc"] as const;
const SCROLL_DIRECTIONS = ["up", "down"] as const;
const TOGGLE_VALUES = ["on", "off"] as const;

// Per-command positional completion, keyed by the command path the walker
// descends through (e.g. "session kill"). Slot 0 is the first positional; a
// dynamic slot names a live list the daemon owns, a static slot a fixed enum.
const positionalDeclarations: Record<string, PositionalSpec[]> = {
  "session attach": [{ kind: "dynamic", source: "sessions" }],
  "session kill": [{ kind: "dynamic", source: "sessions" }],
  "session send-keys": [{ kind: "dynamic", source: "sessions" }],
  "session capture": [{ kind: "dynamic", source: "sessions" }],
  "session exec": [{ kind: "dynamic", source: "sessions" }],
  "session resize": [{ kind: "dynamic", source: "sessions" }],
  "session rename": [{ kind: "dynamic", source: "sessions" }],
  "session pin": [{ kind: "dynamic", source: "sessions" }],
  "session unpin": [{ kind: "dynamic", source: "sessions" }],
  "session press": [{ kind: "dynamic", source: "sessions" }],
  "session wait": [{ kind: "dynamic", source: "sessions" }],
  "session mouse click": [{ kind: "dynamic", source: "sessions" }],
  "session mouse drag": [{ kind: "dynamic", source: "sessions" }],
  "session mouse move": [{ kind: "dynamic", source: "sessions" }],
  "session mouse scroll": [
    { kind: "dynamic", source: "sessions" },
    { kind: "static", values: SCROLL_DIRECTIONS },
  ],
  "session mouse state": [{ kind: "dynamic", source: "sessions" }],
  "secret get": [{ kind: "dynamic", source: "secrets" }],
  "secret delete": [{ kind: "dynamic", source: "secrets" }],
  "secret set": [{ kind: "dynamic", source: "secrets" }],
  "process set": [{ kind: "dynamic", source: "processes" }],
  "process delete": [{ kind: "dynamic", source: "processes" }],
  "theme set": [{ kind: "dynamic", source: "themes" }],
  "theme delete": [{ kind: "dynamic", source: "customThemes" }],
  "font set": [{ kind: "static", values: BUILTIN_FONT_IDS }],
  "font nerd-font": [{ kind: "static", values: TOGGLE_VALUES }],
  "font ligatures": [{ kind: "static", values: TOGGLE_VALUES }],
  "config identity": [{ kind: "static", values: IDENTITY_PROVIDERS }],
};

const serializeOption = (option: Option): OptionSpec => ({
  long: option.long ?? null,
  short: option.short ?? null,
  takesValue: option.required || option.optional,
  argChoices: option.argChoices ? [...option.argChoices] : null,
  hidden: option.hidden,
});

const serializeCommand = (command: Command, parentPath: string[]): CommandSpecNode => {
  const path = [...parentPath, command.name()];
  return {
    name: command.name(),
    aliases: command.aliases(),
    options: command.options.map(serializeOption),
    positionals: positionalDeclarations[path.join(" ")] ?? [],
    subcommands: command.commands
      .filter((child) => !child.name().startsWith("_"))
      .map((child) => serializeCommand(child, path)),
  };
};

// Walk a built commander tree into a plain-data CommandSpec the daemon (and the
// CLI's own _completion fallback) walk for candidates. The root is unnamed —
// words[0] is the program name and never matched — so it doesn't contribute to
// the path keys positional declarations are looked up by. Internal (`_`-prefixed)
// commands are dropped, matching the walker's non-descent rule.
export const serializeProgram = (program: Command): CommandSpec => ({
  name: "",
  aliases: [],
  options: program.options.map(serializeOption),
  positionals: [],
  subcommands: program.commands
    .filter((child) => !child.name().startsWith("_"))
    .map((child) => serializeCommand(child, [])),
});
