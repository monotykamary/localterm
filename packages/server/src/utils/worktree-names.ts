// Memorable two-word worktree names (adjective-noun) instead of timestamps, so
// a worktree list reads as "clever-fox", "brave-summit", … rather than
// "worktree-20260618-143022". Generation is random; callers retry on collision
// with an existing branch/folder and, as a last resort, append a counter.

const ADJECTIVES = [
  "clever",
  "brave",
  "calm",
  "swift",
  "quiet",
  "bold",
  "gentle",
  "merry",
  "wise",
  "noble",
  "eager",
  "lively",
  "crisp",
  "golden",
  "silver",
  "azure",
  "indigo",
  "violet",
  "scarlet",
  "crimson",
  "olive",
  "hazel",
  "misty",
  "frosty",
  "dewy",
  "breezy",
  "sunny",
  "mossy",
  "stony",
  "woody",
  "leafy",
  "rusty",
  "dusty",
  "glassy",
  "silky",
  "sturdy",
  "nimble",
  "placid",
  "serene",
  "tranquil",
  "jovial",
  "dapper",
  "spry",
  "vibrant",
  "mellow",
  "lucid",
  "vivid",
  "ardent",
  "pensive",
  "wistful",
  "drowsy",
  "perky",
  "zesty",
  "glacial",
  "solar",
  "lunar",
  "stellar",
  "cosmic",
  "verdant",
  "amber",
  "coral",
  "ivory",
  "ebony",
] as const;

const NOUNS = [
  "fox",
  "otter",
  "badger",
  "heron",
  "falcon",
  "raven",
  "wren",
  "robin",
  "finch",
  "sparrow",
  "hawk",
  "owl",
  "stag",
  "doe",
  "hare",
  "lynx",
  "beaver",
  "marten",
  "ermine",
  "pine",
  "oak",
  "elm",
  "birch",
  "cedar",
  "maple",
  "willow",
  "aspen",
  "juniper",
  "laurel",
  "rowan",
  "ivy",
  "fern",
  "moss",
  "lichen",
  "flint",
  "quartz",
  "jasper",
  "agate",
  "onyx",
  "topaz",
  "amber",
  "coral",
  "pearl",
  "river",
  "brook",
  "creek",
  "stream",
  "meadow",
  "glade",
  "grove",
  "orchard",
  "harbor",
  "beacon",
  "lantern",
  "compass",
  "anchor",
  "summit",
  "ridge",
  "cliff",
  "vale",
  "dale",
  "moor",
  "fen",
  "marsh",
] as const;

const MAX_RANDOM_ATTEMPTS = 100;
const MAX_COUNTER = 1000;

const pick = (words: readonly string[]): string =>
  words[Math.floor(Math.random() * words.length)] ?? "";

// Returns an adjective-noun phrase not already in `taken`. Random retries cover
// the common case (the word space is large); a counter suffix forces uniqueness
// if random retries keep colliding with an unusually full set.
export const generateWorktreeName = (taken: ReadonlySet<string>): string => {
  for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS; attempt++) {
    const name = `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
    if (name && !taken.has(name)) return name;
  }
  for (let counter = 2; counter <= MAX_COUNTER; counter++) {
    const name = `${pick(ADJECTIVES)}-${pick(NOUNS)}-${counter}`;
    if (name && !taken.has(name)) return name;
  }
  throw new Error("couldn't find a free worktree name");
};
