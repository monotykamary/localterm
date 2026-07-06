// A plain-data mirror of the CLI's commander tree that the daemon (and the CLI's
// own fallback) walk to resolve completion candidates. The CLI serializes its
// built commander tree into this shape; the daemon reads the serialized file so
// it can complete in-process — no Node startup per <Tab>. The root node is
// unnamed (words[0] is the program name and never matched).

export interface OptionSpec {
  long: string | null;
  short: string | null;
  takesValue: boolean;
  argChoices: string[] | null;
  hidden: boolean;
}

export type PositionalSpec =
  | { kind: "static"; values: readonly string[] }
  | { kind: "dynamic"; source: "sessions" | "secrets" | "processes" | "themes" | "customThemes" };

export interface CommandSpecNode {
  name: string;
  aliases: readonly string[];
  options: readonly OptionSpec[];
  positionals: readonly PositionalSpec[];
  subcommands: readonly CommandSpecNode[];
}

export type CommandSpec = CommandSpecNode;
