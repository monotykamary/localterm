// Fira Code builds its ligatures with contextual alternates (calt): the browser
// runs HarfBuzz over a shaped string and the font's own calt table decides
// which subsequences fuse — including the composable arrows assembled from
// start/middle/end fragments (->, -->, --->, ====>, <====, …) and the markdown
// rules (-, --, ---, … and =, ==, ===, …) that no finite sequence list could
// enumerate. So instead of listing sequences, the joiner hands the renderer
// every maximal run of operator characters as one shaped unit and lets the
// font decide. This also reproduces Fira Code's overlapping contextual
// ligatures (e.g. >=> inside =>=>) that a split-by-sequence joiner would miss.
//
// Beyond operators, the joiner also surfaces the two non-operator ligature
// families Fira Code ships by default (verified empirically against the font's
// calt shaping, not guessed): the disambiguation/standard letter pairs
// (fi, fj, Fl, Il, Tl) and www, plus hex/dimension literals (0xFF, 0xDEADBEEF,
// 1920x1080). fl/ff/ffl and <digit><letter> pairs are deliberately excluded —
// Fira Code does not ligature them.
//
// Every terminal font here is monospace, so a font with no calt entry for a
// given run shapes each glyph at its fixed cell advance — byte-identical to
// per-cell drawing. Over-joining is therefore a harmless no-op, and the same
// vocabulary is safe across fonts that don't ligature at all.

const OPERATOR_VOCABULARY: ReadonlySet<string> = new Set(
  "!#$%&()*+,-./:;<=>?@[\\]^_`{|}~".split(""),
);

const LETTER_LIGATURE_PAIRS: ReadonlySet<string> = new Set(["fi", "fj", "Fl", "Il", "Tl"]);

const HEX_DIGITS: ReadonlySet<string> = new Set("0123456789abcdefABCDEF".split(""));
const DECIMAL_DIGITS: ReadonlySet<string> = new Set("0123456789".split(""));

const MIN_OPERATOR_RUN_LENGTH = 2;
const WWW_RUN_LENGTH = 3;

const isDigit = (char: string): boolean => DECIMAL_DIGITS.has(char);
const isHexDigit = (char: string): boolean => HEX_DIGITS.has(char);

const findOperatorRuns = (text: string): [number, number][] => {
  const ranges: [number, number][] = [];
  let runStart = -1;
  for (let index = 0; index <= text.length; index++) {
    const inVocabulary = index < text.length && OPERATOR_VOCABULARY.has(text[index]!);
    if (inVocabulary) {
      if (runStart === -1) runStart = index;
    } else if (runStart !== -1) {
      if (index - runStart >= MIN_OPERATOR_RUN_LENGTH) ranges.push([runStart, index]);
      runStart = -1;
    }
  }
  return ranges;
};

// <digits>x<hex-or-digits>+ — matches 0xFF, 0xDEADBEEF, 1920x1080, 0x0, 1x1.
// Fira Code ligatures the x into a multiplication sign; a lone "0x" with no
// following hex digit is not ligatured and is correctly excluded by the +.
const findHexDimensionRuns = (text: string): [number, number][] => {
  const ranges: [number, number][] = [];
  let index = 0;
  while (index < text.length) {
    if (!isDigit(text[index]!)) {
      index += 1;
      continue;
    }
    let digitEnd = index;
    while (digitEnd < text.length && isDigit(text[digitEnd]!)) digitEnd += 1;
    const separator = text[digitEnd];
    if (separator !== "x" && separator !== "X") {
      index = digitEnd;
      continue;
    }
    let hexEnd = digitEnd + 1;
    while (hexEnd < text.length && isHexDigit(text[hexEnd]!)) hexEnd += 1;
    if (hexEnd > digitEnd + 1) ranges.push([index, hexEnd]);
    index = hexEnd;
  }
  return ranges;
};

const findLetterLigatureRuns = (text: string): [number, number][] => {
  const ranges: [number, number][] = [];
  for (let index = 0; index + 2 <= text.length; index++) {
    if (LETTER_LIGATURE_PAIRS.has(text.slice(index, index + 2))) ranges.push([index, index + 2]);
  }
  return ranges;
};

// Fira Code ligatures exactly "www" (a 3-w run bounded by non-w). Runs of 2 or
// 4+ w's are not ligatured — verified empirically — so only an exact-3 maximal
// run is joined.
const findWwwRuns = (text: string): [number, number][] => {
  const ranges: [number, number][] = [];
  let runStart = -1;
  for (let index = 0; index <= text.length; index++) {
    const isW = index < text.length && text[index] === "w";
    if (isW) {
      if (runStart === -1) runStart = index;
    } else if (runStart !== -1) {
      if (index - runStart === WWW_RUN_LENGTH) ranges.push([runStart, index]);
      runStart = -1;
    }
  }
  return ranges;
};

// Merge overlapping and adjacent ranges so neighbouring ligature sites (e.g.
// "0xf" + "fi" inside "0xfin") shape as one unit, giving HarfBuzz the full
// context Fira Code's calt rules expect. Adjacent merging also collapses
// back-to-back ligatures ("fi->") into a single joined cell.
const mergeRanges = (ranges: [number, number][]): [number, number][] => {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: [number, number][] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
};

export const findLigatureRanges = (text: string): [number, number][] =>
  mergeRanges([
    ...findOperatorRuns(text),
    ...findHexDimensionRuns(text),
    ...findLetterLigatureRuns(text),
    ...findWwwRuns(text),
  ]);
