#!/usr/bin/env node
const CONTROL_URL = process.env.CONTROL_URL || "http://127.0.0.1:8766";

const argvRuns = process.argv.find((a) => a.startsWith("runs="));
const argvConc = process.argv.find((a) => a.startsWith("concurrency="));
const runs = argvRuns ? Number(argvRuns.split("=")[1]) : 16;
const concurrency = argvConc ? Number(argvConc.split("=")[1]) : 8;

async function once(i) {
  const params = new URLSearchParams({ scenario: "awaitfont" });
  const res = await fetch(`${CONTROL_URL}/run-race?${params.toString()}`);
  const body = await res.json();
  if (!res.ok) return { i, error: body.error };
  const ref400 = body.references?.[400]?.lit ?? null;
  const ref600 = body.references?.[600]?.lit ?? null;
  const ns = body.naiveHeal?.stateAtClear ?? {};
  const na = body.naiveHeal?.atlasCoverage ?? {};
  const vs = body.verifiedHeal?.stateAtClear ?? {};
  const va = body.verifiedHeal?.atlasCoverage ?? {};
  const naiveBold = na.lit != null && va.lit != null && na.lit > va.lit + 500;
  return {
    i,
    naive: {
      geistLoaded400AtClear: ns.geistLoaded400,
      loadedAtClear: ns.loaded,
      atlasLit: na.lit,
      atlasLuma: na.lumaSum,
    },
    verified: {
      geistLoaded400AtClear: vs.geistLoaded400,
      geistLoaded700AtClear: vs.geistLoaded700,
      pollMs: vs.pollMs,
      atlasLit: va.lit,
      atlasLuma: va.lumaSum,
    },
    ref400lit: ref400,
    ref600lit: ref600,
    naiveBold,
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
  const naiveUnloaded = ok.filter((r) => r.naive.geistLoaded400AtClear === false).length;
  const verifiedLoaded = ok.filter((r) => r.verified.geistLoaded400AtClear === true).length;
  const naiveBoldCount = ok.filter((r) => r.naiveBold).length;
  // Average atlas ink across samples — naive should track ref600, verified ref400.
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  const naiveAvg = avg(ok.map((r) => r.naive.atlasLit ?? 0).filter(Boolean));
  const verifiedAvg = avg(ok.map((r) => r.verified.atlasLit ?? 0).filter(Boolean));
  console.log(
    JSON.stringify({
      summary: {
        runs,
        concurrency,
        wallMs: Date.now() - startedAt,
        ok: ok.length,
        naiveUnloadedFaceAtClear: naiveUnloaded,
        verifiedLoadedFaceAtClear: verifiedLoaded,
        naiveBoldAtlas: naiveBoldCount,
        naiveAvgAtlasLit: naiveAvg,
        verifiedAvgAtlasLit: verifiedAvg,
        ref400lit: ok[0]?.ref400lit ?? null,
        ref600lit: ok[0]?.ref600lit ?? null,
      },
    }),
  );
})();
