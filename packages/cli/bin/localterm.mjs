#!/usr/bin/env node
const { trySecretGetFastPath } = await import("../dist/secret-get-fast-path.js");

if (!(await trySecretGetFastPath(process.argv.slice(2)))) {
  await import("../dist/index.js");
}
