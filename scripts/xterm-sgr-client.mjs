#!/usr/bin/env node
const CONTROL_URL = process.env.CONTROL_URL || "http://127.0.0.1:8766";

const args = process.argv.slice(2).join("&");
const params = args ? `?${args}` : "";

async function runSgrTest() {
  const response = await fetch(`${CONTROL_URL}/run-sgr${params}`);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`sgr test failed: ${JSON.stringify(body)}`);
  }
  return body;
}

runSgrTest()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
