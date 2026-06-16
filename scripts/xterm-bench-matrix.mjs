#!/usr/bin/env node
const CONTROL_URL = process.env.CONTROL_URL || "http://127.0.0.1:8766";

const RENDERERS = ["dom", "webgl", "canvas"];
const MODES = ["glyph", "opentui"];

async function runCombination(renderer, mode) {
  const params = new URLSearchParams({
    renderer,
    mode,
    frames: "300",
    fit: "1",
    throttle: "1",
  });
  const response = await fetch(`${CONTROL_URL}/run?${params.toString()}`);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${renderer}/${mode} failed: ${JSON.stringify(body)}`);
  }
  return { renderer, mode, body };
}

async function main() {
  const statusResponse = await fetch(`${CONTROL_URL}/status`);
  if (!statusResponse.ok) {
    throw new Error(`control server not reachable at ${CONTROL_URL}`);
  }
  const status = await statusResponse.json();
  console.log("daemon status:", status);

  const results = [];
  for (const renderer of RENDERERS) {
    for (const mode of MODES) {
      const run = await runCombination(renderer, mode);
      results.push(run);
    }
  }

  console.log("\n--- summary ---");
  console.table(
    results.map(({ renderer, mode, body }) => ({
      renderer,
      mode,
      cols: body.cols,
      rows: body.rows,
      presentedFps: body.presentedFps,
      wallFps: body.wallFps,
      dropped: body.framesDropped,
      edgeScore: body.pixelMetrics?.edgeScore,
      uniqueColors: body.pixelMetrics?.uniqueColors,
    })),
  );

  console.log("\n--- full results ---");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
