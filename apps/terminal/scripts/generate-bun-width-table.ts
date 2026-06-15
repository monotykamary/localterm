/**
 * Build-time script: compares Bun.stringWidth against xterm's 15-graphemes
 * provider for every relevant Unicode codepoint and emits a compact override
 * table as bun-width-overrides.ts.
 *
 * Run from apps/terminal: bun run scripts/generate-bun-width-table.ts
 */

import { Terminal } from "@xterm/xterm";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";

// --- Set up the xterm provider ---

const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
term.loadAddon(new UnicodeGraphemesAddon());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const core = (term as any)._core;
const provider: Provider = core.unicodeService._activeProvider;

interface Provider {
  wcwidth(cp: number): 0 | 1 | 2;
  charProperties(cp: number, preceding: number): number;
}

// --- Bun.stringWidth ---

const bunWidth = (cp: number): number =>
  Bun.stringWidth(String.fromCodePoint(cp), { ambiguousIsNarrow: true });

// --- Quick validation ---
console.log("Validation:");
console.log("  Addon wcwidth A:", provider.wcwidth(0x41), "(expect 1)");
console.log("  Addon wcwidth 一:", provider.wcwidth(0x4e00), "(expect 2)");
console.log("  Addon wcwidth ️:", provider.wcwidth(0xfe0f), "(expect 0)");
console.log("  Bun width A:", bunWidth(0x41), "(expect 1)");
console.log("  Bun width 一:", bunWidth(0x4e00), "(expect 2)");

// --- Extract shouldJoin from charProperties ---

// charProperties packs: (charKind << 3) | (width << 1) | shouldJoin
// For preceding = Latin 'A' (Other, width 1, no join): packed value = 2
const PRECEDING_LATIN_A = 2;

function addonShouldJoin(cp: number): boolean {
  const props = provider.charProperties(cp, PRECEDING_LATIN_A);
  return (props & 1) === 1;
}

// --- Scan Unicode blocks for discrepancies ---

// Scan the entire BMP (0x0000–0xFFFF) and SMP (0x10000–0x10FFFF).
// Bun.stringWidth takes ~1µs per codepoint so the full scan completes in
// under 2 seconds — no need to maintain a curated block list that drifts.
const SCAN_START = 0x0000;
const SCAN_END = 0x10ffff;

interface Override {
  codepoint: number;
  bunW: number;
  addonW: number;
  shouldJoin: boolean;
}

const overrides: Override[] = [];

console.log("\nScanning Unicode blocks...");

for (let cp = SCAN_START; cp <= SCAN_END; cp++) {
  if (cp <= 0x001f) continue; // C0 controls: handled by VT parser
  if (cp >= 0x007f && cp <= 0x009f) continue; // C1 controls + DEL
  if (cp >= 0xd800 && cp <= 0xdfff) continue; // surrogates
  if ((cp & 0xfffe) === 0xfffe) continue; // non-characters

  const bW = bunWidth(cp);
  const aW = provider.wcwidth(cp);

  if (bW !== aW) {
    overrides.push({
      codepoint: cp,
      bunW: bW,
      addonW: aW,
      shouldJoin: addonShouldJoin(cp),
    });
  }
}

console.log(
  `Found ${overrides.length} codepoints where Bun.stringWidth disagrees with the xterm 15-graphemes addon`,
);

const width0: number[] = [];
const width1: number[] = [];
const width2: number[] = [];
const wideJoining: number[] = [];

for (const o of overrides) {
  if (o.bunW === 0) {
    width0.push(o.codepoint);
  } else if (o.bunW === 1) {
    width1.push(o.codepoint);
  } else if (o.bunW === 2) {
    // Determine if the base provider's shouldJoin for this mark matches
    // Bun's behavior. If the addon already joins it and Bun also
    // clusters it with a preceding base, we should keep shouldJoin
    // and just widen. If the addon joins it but Bun treats it as
    // standalone, we must clear shouldJoin.
    //
    // Test with multiple base chars: narrow (A), wide (一), emoji (👍).
    // If ANY combination shows joining (< sum), the mark is a joining mark.
    const bases = [
      [0x41, "A"], // narrow
      [0x4e00, "一"], // wide
      [0x1f44d, "👍"], // emoji
    ];
    let doesJoin = false;
    for (const [baseCp] of bases) {
      const baseChar = String.fromCodePoint(baseCp);
      const markChar = String.fromCodePoint(o.codepoint);
      const sum = bunWidth(baseCp) + bunWidth(o.codepoint);
      const combined = Bun.stringWidth(baseChar + markChar, { ambiguousIsNarrow: true });
      if (combined < sum) {
        doesJoin = true;
        break;
      }
    }

    if (doesJoin) {
      wideJoining.push(o.codepoint);
    } else {
      width2.push(o.codepoint);
    }
  }
}

console.log(`  Bun=0 (addon says 1): ${width0.length} codepoints`);
console.log(`  Bun=1 (addon says 0): ${width1.length} codepoints`);
console.log(`  Bun=2, standalone (addon says 1): ${width2.length} codepoints`);
console.log(`  Bun=2, joining (addon says 0): ${wideJoining.length} codepoints`);

function toRanges(codepoints: number[]): [number, number][] {
  if (codepoints.length === 0) return [];
  const sorted = [...codepoints].sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === rangeEnd + 1) {
      rangeEnd = sorted[i];
    } else {
      ranges.push([rangeStart, rangeEnd]);
      rangeStart = sorted[i];
      rangeEnd = sorted[i];
    }
  }
  ranges.push([rangeStart, rangeEnd]);
  return ranges;
}

const width0Ranges = toRanges(width0);
const width1Ranges = toRanges(width1);
const width2Ranges = toRanges(width2);
const wideJoiningRanges = toRanges(wideJoining);

function formatRanges(ranges: [number, number][]): string {
  return ranges
    .map(([s, e]) =>
      s === e
        ? `  [0x${s.toString(16)}, 0x${s.toString(16)}],`
        : `  [0x${s.toString(16)}, 0x${e.toString(16)}],`,
    )
    .join("\n");
}

const BUN_VERSION = Bun.version;
const TIMESTAMP = new Date().toISOString();
const overrideMin = Math.min(...overrides.map((o) => o.codepoint));
const overrideMax = Math.max(...overrides.map((o) => o.codepoint));

const source = `// Auto-generated by scripts/generate-bun-width-table.ts
// Bun version: ${BUN_VERSION}
// Generated at: ${TIMESTAMP}
// Total discrepancies: ${overrides.length} codepoints
//   Bun=0 (addon=1): ${width0.length} | Bun=1 (addon=0): ${width1.length}
//   Bun=2 standalone (addon=1): ${width2.length} | Bun=2 joining (addon=0): ${wideJoining.length}
//
// DO NOT EDIT MANUALLY — re-run the generator if Bun.stringWidth changes.

const WIDTH_0_RANGES: ReadonlyArray<readonly [number, number]> = [
${formatRanges(width0Ranges)}
];

const WIDTH_1_RANGES: ReadonlyArray<readonly [number, number]> = [
${formatRanges(width1Ranges)}
];

const WIDTH_2_RANGES: ReadonlyArray<readonly [number, number]> = [
${formatRanges(width2Ranges)}
];

const WIDE_JOINING_RANGES: ReadonlyArray<readonly [number, number]> = [
${formatRanges(wideJoiningRanges)}
];

const OVERRIDE_FIRST = 0x${overrideMin.toString(16)};
const OVERRIDE_LAST = 0x${overrideMax.toString(16)};

const binarySearch = (
  ranges: ReadonlyArray<readonly [number, number]>,
  codepoint: number,
): boolean => {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = ranges[mid];
    if (codepoint < start) hi = mid - 1;
    else if (codepoint > end) lo = mid + 1;
    else return true;
  }
  return false;
};

/**
 * Returns the width Bun.stringWidth assigns to this codepoint where it
 * disagrees with the xterm 15-graphemes addon. Returns -1 when the
 * addon and Bun agree (no override needed).
 *
 * Width 0: invisible codepoints Bun excludes but the addon counts as 1.
 * Width 1: combining marks Bun counts as spacing but the addon joins (0).
 * Width 2: emoji/ideographs Bun counts as wide but the addon counts as 1.
 */
export const bunWidthOverride = (codepoint: number): -1 | 0 | 1 | 2 => {
  if (codepoint < OVERRIDE_FIRST || codepoint > OVERRIDE_LAST) return -1;
  if (binarySearch(WIDTH_0_RANGES, codepoint)) return 0;
  if (binarySearch(WIDTH_1_RANGES, codepoint)) return 1;
  if (binarySearch(WIDTH_2_RANGES, codepoint)) return 2;
  if (binarySearch(WIDE_JOINING_RANGES, codepoint)) return 2;
  return -1;
};

/**
 * Codepoints Bun counts as width-2 that must join into the preceding
 * cluster (shouldJoin=true) instead of becoming a standalone cell.
 */
export const isWideJoiningMarkOverride = (codepoint: number): boolean =>
  codepoint >= OVERRIDE_FIRST &&
  codepoint <= OVERRIDE_LAST &&
  binarySearch(WIDE_JOINING_RANGES, codepoint);
`;

import * as path from "path";
import * as fs from "fs";

const OUT_PATH = path.resolve(import.meta.dir, "../src/utils/bun-width-overrides.ts");
fs.writeFileSync(OUT_PATH, source);
console.log(`\nWrote ${OUT_PATH} (${(Buffer.byteLength(source) / 1024).toFixed(1)} KB)`);
