#!/usr/bin/env node
const CONTROL_URL = process.env.CONTROL_URL || "http://127.0.0.1:8766";

const args = process.argv.slice(2).join("&");
const params = args ? `?${args}` : "";

async function runRaceTest() {
  const response = await fetch(`${CONTROL_URL}/run-race${params}`);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`race test failed: ${JSON.stringify(body)}`);
  }
  return body;
}

runRaceTest()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
