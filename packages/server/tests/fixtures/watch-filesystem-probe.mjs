import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

const mode = process.argv[2];
const root = process.argv[3];
const moduleUrl =
  process.argv[4] ?? new URL("../../dist/utils/watch-with-recovery.js", import.meta.url).href;
const originalWatch = fs.watch;
let watchCount = 0;
let closeCount = 0;
let reportedErrors = 0;
const events = [];
const delivered = Promise.withResolvers();
let subscription;
let deadline;

fs.writeFileSync(path.join(root, "marker"), "before");
if (mode === "budget") {
  for (let index = 0; index < 512; index += 1)
    fs.writeFileSync(path.join(root, `file-${index}`), "");
} else {
  os.platform = () => "linux";
  console.warn = (message) => {
    assert.match(message, /EMFILE/);
    reportedErrors += 1;
  };
}
fs.watch = (...args) => {
  watchCount += 1;
  if (mode === "budget") {
    const handle = originalWatch(...args);
    const close = handle.close.bind(handle);
    handle.close = () => {
      closeCount += 1;
      return close();
    };
    // fs.watch has no readiness event; test the descriptor budget without racing
    // FSEvents startup. The handle allocation is real, only delivery is injected.
    setImmediate(() => handle.emit("change", "change", "marker"));
    return handle;
  }
  const handle = Object.assign(new EventEmitter(), {
    close() {
      closeCount += 1;
    },
  });
  setImmediate(() => {
    handle.emit(
      "error",
      Object.assign(new Error("EMFILE: injected native watcher error"), { code: "EMFILE" }),
    );
    delivered.resolve();
  });
  return handle;
};
syncBuiltinESMExports();

try {
  const { watchWithRecovery } = await import(moduleUrl);
  subscription = watchWithRecovery(root, { recursive: true }, (event, filename) => {
    events.push([event, filename]);
    if (filename === "marker") delivered.resolve();
  });
  fs.writeFileSync(path.join(root, "marker"), "after");
  await Promise.race([
    delivered.promise,
    new Promise((_resolve, reject) => {
      deadline = setTimeout(
        () =>
          reject(
            new Error(
              `Watcher probe did not deliver its event: ${JSON.stringify({ watchCount, events: events.slice(0, 5) })}`,
            ),
          ),
        2000,
      );
    }),
  ]);
  subscription.close();
  await new Promise(setImmediate);
  if (mode === "budget") {
    assert.equal(watchCount, 1);
    assert.equal(closeCount, 1);
  } else {
    assert.ok(reportedErrors > 0);
    assert.equal(closeCount, watchCount);
  }
  console.log(JSON.stringify({ mode, watchCount, closeCount, reportedErrors, passed: true }));
} finally {
  clearTimeout(deadline);
  subscription?.close();
}
