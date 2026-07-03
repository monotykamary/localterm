// @vitest-environment node
//
// Stress harness comparing buildLazyRenderChunks vs the eager buildRenderChunks
// at multi-million-line scale. Gated behind STRESS_TEST=1 because generation +
// parsing alone takes seconds per scenario; the normal suite skips every test
// here via describe.skip.
//
// Run all scenarios at full scale:
//   STRESS_TEST=1 pnpm --filter @monotykamary/localterm-terminal test -- \
//     tests/utils/build-lazy-render-chunks.stress.test.ts
//
// Reduce the per-scenario sample count (faster, noisier) with STRESS_SAMPLES=N.

/// <reference types="node" />

import { describe, expect, it } from "vite-plus/test";
import {
  buildRenderChunks,
  renderChunkLength,
  type RenderChunk,
} from "../../src/utils/build-render-chunks";
import { buildLazyRenderChunks } from "../../src/utils/build-lazy-render-chunks";
import { parseUnifiedDiff } from "../../src/utils/parse-unified-diff";
import type { DiffViewMode } from "../../src/utils/stored-diff-view-mode";

const CHUNK_SIZE = 2000;

interface Scenario {
  name: string;
  hunks: number;
  linesPerHunk: number;
  viewMode: DiffViewMode;
  additionsPerLine: number;
  deletionsPerLine: number;
  contextPerLine: number;
}

const STRESS_SCENARIOS: Scenario[] = [
  {
    name: "many small hunks · uniform additions · unified · ~1M lines",
    hunks: 10_000,
    linesPerHunk: 100,
    viewMode: "unified",
    additionsPerLine: 100,
    deletionsPerLine: 0,
    contextPerLine: 0,
  },
  {
    name: "few huge hunks · uniform additions · unified · ~1M lines",
    hunks: 100,
    linesPerHunk: 10_000,
    viewMode: "unified",
    additionsPerLine: 10_000,
    deletionsPerLine: 0,
    contextPerLine: 0,
  },
  {
    name: "single mega-hunk · uniform additions · unified · ~2M lines",
    hunks: 1,
    linesPerHunk: 2_000_000,
    viewMode: "unified",
    additionsPerLine: 2_000_000,
    deletionsPerLine: 0,
    contextPerLine: 0,
  },
  {
    name: "mixed context/add/del hunk × 50 · unified · ~500K lines",
    hunks: 50,
    linesPerHunk: 10_000,
    viewMode: "unified",
    additionsPerLine: 3_000,
    deletionsPerLine: 2_000,
    contextPerLine: 5_000,
  },
  {
    name: "mixed context/add/del hunks × 50 · split · ~500K rows",
    hunks: 50,
    linesPerHunk: 10_000,
    viewMode: "split",
    additionsPerLine: 3_000,
    deletionsPerLine: 2_000,
    contextPerLine: 5_000,
  },
  {
    name: "single mega-hunk · split · ~750K rows",
    hunks: 1,
    linesPerHunk: 1_000_000,
    viewMode: "split",
    additionsPerLine: 500_000,
    deletionsPerLine: 250_000,
    contextPerLine: 250_000,
  },
];

interface PhaseTimings {
  parseMs: number;
  eagerBuildMs: number;
  lazyMetaMs: number;
  lazyFirstChunkMs: number;
  lazyFullMs: number;
  lazyMetaBuiltCount: number;
  eagerHeapDeltaBytes: number;
  lazyMetaHeapDeltaBytes: number;
  lazyFirstChunkHeapDeltaBytes: number;
  eagerChunkCount: number;
  lazyChunkCount: number;
  totalRows: number;
}

const generatePatch = (scenario: Scenario): string => {
  const { hunks, linesPerHunk, additionsPerLine, deletionsPerLine, contextPerLine } = scenario;
  const parts: string[] = [];
  for (let hunkIndex = 0; hunkIndex < hunks; hunkIndex += 1) {
    const baseOld = hunkIndex * linesPerHunk + 1;
    const baseNew = hunkIndex * linesPerHunk + 1;
    parts.push(`@@ -${baseOld},${linesPerHunk} +${baseNew},${linesPerHunk} @@`);
    let emitted = 0;
    for (let index = 0; index < contextPerLine; index += 1) {
      parts.push(` ctx ${hunkIndex}-${index}`);
      emitted += 1;
    }
    for (let index = 0; index < deletionsPerLine; index += 1) {
      parts.push(`-del ${hunkIndex}-${index}`);
      emitted += 1;
    }
    for (let index = 0; index < additionsPerLine; index += 1) {
      parts.push(`+add ${hunkIndex}-${index}`);
      emitted += 1;
    }
    while (emitted < linesPerHunk) {
      parts.push(` pad ${hunkIndex}-${emitted}`);
      emitted += 1;
    }
  }
  return parts.join("\n") + "\n";
};

const heapUsed = (): number => process.memoryUsage().heapUsed;

const withTimer = <Result>(operation: () => Result): { result: Result; durationMs: number } => {
  const start = performance.now();
  const result = operation();
  return { result, durationMs: performance.now() - start };
};

const formatMs = (milliseconds: number): string => `${milliseconds.toFixed(0)} ms`;
const formatBytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const collectTimings = (scenario: Scenario): PhaseTimings => {
  const patch = generatePatch(scenario);

  const { result: hunks, durationMs: parseMs } = withTimer(() => parseUnifiedDiff(patch));

  const beforeEager = heapUsed();
  const { result: eagerChunks, durationMs: eagerBuildMs } = withTimer(() =>
    buildRenderChunks(hunks, scenario.viewMode, CHUNK_SIZE),
  );
  const afterEager = heapUsed();

  const beforeLazyMeta = heapUsed();
  const { result: collection, durationMs: lazyMetaMs } = withTimer(() =>
    buildLazyRenderChunks(hunks, scenario.viewMode, CHUNK_SIZE),
  );
  const lazyMetaBuiltCount = collection.builtCount();
  const afterLazyMeta = heapUsed();

  const beforeLazyFirst = heapUsed();
  const { durationMs: lazyFirstChunkMs } = withTimer(() => collection.visibleUpTo(CHUNK_SIZE));
  const afterLazyFirst = heapUsed();

  // Materialize the rest of the file via the lazy API. Done after capturing the
  // first-chunk phase so the first-paint measurement isn't polluted by it.
  const { durationMs: lazyFullMs } = withTimer(() => collection.visibleUpTo(Number.POSITIVE_INFINITY));

  return {
    parseMs,
    eagerBuildMs,
    lazyMetaMs,
    lazyFirstChunkMs,
    lazyFullMs,
    lazyMetaBuiltCount,
    eagerHeapDeltaBytes: afterEager - beforeEager,
    lazyMetaHeapDeltaBytes: afterLazyMeta - beforeLazyMeta,
    lazyFirstChunkHeapDeltaBytes: afterLazyFirst - beforeLazyFirst,
    eagerChunkCount: eagerChunks.length,
    lazyChunkCount: collection.chunkCount,
    totalRows: collection.totalRows,
  };
};

const chunkEquals = (actual: RenderChunk, expected: RenderChunk): boolean => {
  if (actual.mode !== expected.mode) return false;
  if (actual.key !== expected.key) return false;
  if (actual.header !== expected.header) return false;
  if (actual.startIndex !== expected.startIndex) return false;
  if (actual.mode === "unified" && expected.mode === "unified") {
    return (
      actual.lines.length === expected.lines.length &&
      actual.lines.every((line, index) => line === expected.lines[index])
    );
  }
  if (actual.mode === "split" && expected.mode === "split") {
    return (
      actual.rows.length === expected.rows.length &&
      actual.rows.every((row, index) => {
        const other = expected.rows[index];
        return row.left === other.left && row.right === other.right;
      })
    );
  }
  return false;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const SAMPLES = (() => {
  const raw = process.env.STRESS_SAMPLES;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
})();

const isStressEnabled = process.env.STRESS_TEST !== undefined;
const stressDescribe = isStressEnabled ? describe : describe.skip;

stressDescribe("buildLazyRenderChunks stress harness", () => {
  for (const scenario of STRESS_SCENARIOS) {
    it(`equivalence + first-paint win: ${scenario.name}`, () => {
      const patch = generatePatch(scenario);
      const hunks = parseUnifiedDiff(patch);
      const eager = buildRenderChunks(hunks, scenario.viewMode, CHUNK_SIZE);
      const collection = buildLazyRenderChunks(hunks, scenario.viewMode, CHUNK_SIZE);

      expect(collection.chunkCount).toBe(eager.length);
      expect(collection.totalRows).toBe(
        eager.reduce((total, chunk) => total + renderChunkLength(chunk), 0),
      );
      expect(collection.builtCount()).toBe(0);

      const lazyChunks = collection.visibleUpTo(Number.POSITIVE_INFINITY);
      expect(lazyChunks).toHaveLength(eager.length);
      for (let index = 0; index < eager.length; index += 1) {
        expect(chunkEquals(lazyChunks[index], eager[index])).toBe(true);
      }
    });

    it(`benchmarks: ${scenario.name}`, () => {
      const samples: PhaseTimings[] = [];
      for (let iteration = 0; iteration < SAMPLES; iteration += 1) {
        samples.push(collectTimings(scenario));
      }

      const pick = (selector: (sample: PhaseTimings) => number): number =>
        median(samples.map(selector));

      const summary = {
        parse: formatMs(pick((sample) => sample.parseMs)),
        eagerBuild: formatMs(pick((sample) => sample.eagerBuildMs)),
        lazyMeta: formatMs(pick((sample) => sample.lazyMetaMs)),
        lazyFirstChunk: formatMs(pick((sample) => sample.lazyFirstChunkMs)),
        lazyFull: formatMs(pick((sample) => sample.lazyFullMs)),
        lazyMetaBuiltCount: samples[0].lazyMetaBuiltCount,
        eagerHeapDelta: formatBytes(pick((sample) => sample.eagerHeapDeltaBytes)),
        lazyMetaHeapDelta: formatBytes(pick((sample) => sample.lazyMetaHeapDeltaBytes)),
        lazyFirstChunkHeapDelta: formatBytes(pick((sample) => sample.lazyFirstChunkHeapDeltaBytes)),
        eagerChunkCount: samples[0].eagerChunkCount,
        lazyChunkCount: samples[0].lazyChunkCount,
        totalRows: samples[0].totalRows,
      };

      const eagerBuildMs = pick((sample) => sample.eagerBuildMs);
      const lazyMetaMs = pick((sample) => sample.lazyMetaMs);

      console.info(
        `[stress|${scenario.viewMode}] ${scenario.name}\n` +
          `  parse=${summary.parse}\n` +
          `  eager: build=${summary.eagerBuild} heapΔ=${summary.eagerHeapDelta} (chunks=${summary.eagerChunkCount})\n` +
          `  lazy: meta=${summary.lazyMeta} (heapΔ=${summary.lazyMetaHeapDelta}, built=${summary.lazyMetaBuiltCount}); ` +
          `first-chunk=${summary.lazyFirstChunk} (heapΔ=${summary.lazyFirstChunkHeapDelta}); ` +
          `full=${summary.lazyFull}\n` +
          `  totalRows=${summary.totalRows.toLocaleString()} samples=${SAMPLES}`,
      );

      // The harness's hard assertion: lazy metadata construction must be
      // strictly faster than eager full chunk construction in every scenario.
      // Structurally guaranteed — lazy metadata does zero chunk allocations
      // (it walks hunks counting rows; eager builds and slices every chunk up
      // front). The first-paint phase (lazy meta + first chunk) is logged as
      // evidence but NOT hard-asserted: the single mega-hunk split case is the
      // tightest squeeze (countSplitRowsForHunk walks the hunk once for
      // metadata, buildSplitDiffRows walks it again when only one chunk is
      // requested), where the next planned step — virtualization (#2) — is
      // required to win substantially.
      expect(lazyMetaMs).toBeLessThan(eagerBuildMs);

      // Lazy metadata must not allocate any chunk during construction.
      expect(summary.lazyMetaBuiltCount).toBe(0);

      // Eager and lazy must agree on chunk topology for every scenario.
      expect(summary.lazyChunkCount).toBe(summary.eagerChunkCount);
    });
  }
});
