#!/usr/bin/env node
const CONTROL_URL = process.env.CONTROL_URL || "http://127.0.0.1:8766";

const argvRuns = process.argv.find((a) => a.startsWith("runs="));
const argvConc = process.argv.find((a) => a.startsWith("concurrency="));
const runs = argvRuns ? Number(argvRuns.split("=")[1]) : 16;
const concurrency = argvConc ? Number(argvConc.split("=")[1]) : 8;

// Atlas ink threshold separating a 400-baked atlas from a 600-baked one.
// ref400 ~= 12597, ref600 ~= 14515 in prior measurements; midpoint ~= 13556.
const BOLD_ATLAS_LIT = 13500;

function verdictOf(healedLit, ref400, ref600) {
  if (healedLit == null) return "n/a";
  if (ref400 != null && Math.abs(healedLit - ref400) < 800) return "HEALED(400)";
  if (ref600 != null && Math.abs(healedLit - ref600) < 800) return "BOLD(600)";
  return healedLit >= BOLD_ATLAS_LIT ? "BOLD" : "HEALED";
}

async function once(i) {
  const params = new URLSearchParams({ scenario: "appfaithful" });
  const res = await fetch(`${CONTROL_URL}/run-race?${params.toString()}`);
  const body = await res.json();
  if (!res.ok) return { i, error: body.error };
  const ref400 = body.references?.[400]?.lit ?? null;
  const ref600 = body.references?.[600]?.lit ?? null;
  const pa = body.poisoned?.atlasCoverage ?? {};
  const hs = body.healed?.stateAtClear ?? {};
  const ha = body.healed?.atlasCoverage ?? {};
  const fr = body.healed?.fullRebuildCoverage ?? {};
  const verdict = verdictOf(ha.lit, ref400, ref600);
  const rebuildVerdict = verdictOf(fr.lit, ref400, ref600);
  return {
    i,
    poisoned: { atlasLit: pa.lit, atlasLuma: pa.lumaSum },
    heal: {
      geistLoaded400: hs.geistLoaded400,
      healMs: hs.healMs,
      timedOut: hs.timedOut,
      clearProbe: hs.clearProbe,
      preClearLit: hs.preClearLit,
      postClearLit: hs.postClearLit,
      postRebuildLit: hs.postRebuildLit,
      clearVerdict: verdict,
      rebuildVerdict,
    },
    ref400lit: ref400,
    ref600lit: ref600,
  };
}

async function worker(getNext) {
  const out = [];
  while (true) {
    const i = getNext();
    if (i === null) break;
    try {
      const r = await once(i);
      out.push(r);
      process.stdout.write(JSON.stringify(r) + "\n");
    } catch (error) {
      const r = { i, error: error.message };
      out.push(r);
      process.stdout.write(JSON.stringify(r) + "\n");
    }
  }
  return out;
}

(async () => {
  let next = 0;
  const getNext = () => (next < runs ? next++ : null);
  const startedAt = Date.now();
  const batches = await Promise.all(Array.from({ length: concurrency }, () => worker(getNext)));
  const results = batches.flat();
  const ok = results.filter((r) => !r.error);
  const clearHealed = ok.filter((r) => r.heal.clearVerdict.startsWith("HEALED")).length;
  const clearBold = ok.filter((r) => r.heal.clearVerdict.startsWith("BOLD")).length;
  const rebuildHealed = ok.filter((r) => r.heal.rebuildVerdict.startsWith("HEALED")).length;
  const rebuildBold = ok.filter((r) => r.heal.rebuildVerdict.startsWith("BOLD")).length;
  const poisonBoldCount = ok.filter(
    (r) => r.poisoned.atlasLit != null && r.poisoned.atlasLit >= BOLD_ATLAS_LIT,
  ).length;
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  const poisonedAvg = avg(ok.map((r) => r.poisoned.atlasLit ?? 0).filter(Boolean));
  const postClearAvg = avg(ok.map((r) => r.heal.postClearLit ?? 0).filter(Boolean));
  const postRebuildAvg = avg(ok.map((r) => r.heal.postRebuildLit ?? 0).filter(Boolean));
  console.log(
    JSON.stringify({
      summary: {
        runs,
        concurrency,
        wallMs: Date.now() - startedAt,
        ok: ok.length,
        poisonBoldAtlas: poisonBoldCount,
        clearHealed,
        clearBold,
        rebuildHealed,
        rebuildBold,
        poisonedAvgAtlasLit: poisonedAvg,
        postClearAvgAtlasLit: postClearAvg,
        postRebuildAvgAtlasLit: postRebuildAvg,
        ref400lit: ok[0]?.ref400lit ?? null,
        ref600lit: ok[0]?.ref600lit ?? null,
      },
    }),
  );
})();
