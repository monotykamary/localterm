import type { LanguageRegistration } from "shiki";

// Bend 2's laws, quantities and proof terms are not Python syntax.
const bendGrammar: LanguageRegistration = {
  name: "bend",
  displayName: "Bend",
  scopeName: "source.bend",
  repository: {},
  patterns: [
    { name: "comment.line.number-sign.bend", match: "#.*$" },
    {
      name: "string.quoted.double.bend",
      begin: '"',
      end: '"|$',
      patterns: [{ name: "constant.character.escape.bend", match: "\\\\." }],
    },
    {
      name: "string.quoted.single.bend",
      begin: "'",
      end: "'|$",
      patterns: [{ name: "constant.character.escape.bend", match: "\\\\." }],
    },
    {
      match: "\\b(def|law)\\s+([A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*)",
      captures: {
        1: { name: "storage.type.function.bend" },
        2: { name: "entity.name.function.bend" },
      },
    },
    {
      match: "\\b(type)\\s+([A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*)",
      captures: {
        1: { name: "storage.type.bend" },
        2: { name: "entity.name.type.bend" },
      },
    },
    {
      match: "\\b(import)\\s+([^\\s\"'#]+)",
      captures: {
        1: { name: "keyword.control.import.bend" },
        2: { name: "entity.name.namespace.bend" },
      },
    },
    { name: "storage.modifier.bend", match: "@unsafe\\b" },
    {
      name: "keyword.control.bend",
      match: "\\b(?:import|as|is|for|exs|where|match|case|do|return)\\b",
    },
    { name: "variable.language.bend", match: "\\?[A-Za-z_]\\w*" },
    { name: "constant.numeric.bend", match: "&[012]\\b" },
    {
      name: "constant.numeric.bend",
      match: "\\b(?:0[xX][0-9a-fA-F]+|[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?n?)\\b",
    },
    { name: "constant.language.boolean.bend", match: "\\b(?:True|False)\\b" },
    {
      name: "support.type.bend",
      match: "\\b(?:Type|Data|Kind|Quant|Nat|U32|F32|Char|String|Bool|IO)\\b(?!\\.)",
    },
    {
      name: "entity.name.function.bend",
      match: "\\b[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*(?=!?\\s*\\()",
    },
    {
      name: "entity.name.type.bend",
      match: "\\b(?:[A-Za-z_]\\w*\\.)*[A-Z]\\w*\\b",
    },
    { name: "variable.other.bend", match: "\\b[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*\\b" },
    {
      name: "keyword.operator.bend",
      match: "<&>|\\.[&|^]\\.|->|=>|<-|==|!=|<=|>=|<>|<<|>>|&&|\\|\\||\\+\\+|[-+*/%=<>!&|^~@]",
    },
    { name: "punctuation.bend", match: "[()\\[\\]{},:;.]" },
  ],
};

export default bendGrammar;
