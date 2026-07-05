import { createRequire } from "node:module";

const require = createRequire(new URL("../packages/server/package.json", import.meta.url));
const { Terminal } = require("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize");

const COLS = 40;
const ROWS = 10;

const src = new Terminal({ cols: COLS, rows: ROWS, scrollback: 1000, allowProposedApi: true });
const serializeAddon = new SerializeAddon();
src.loadAddon(serializeAddon);

src.write("\x1b[?1049h"); // enter alt-screen
src.write("\x1b[2J\x1b[H"); // clear + home
src.write("\x1b[1;31mRed\x1b[0m plain ");
src.write("\x1b[4;32munderlined green\x1b[0m ");
src.write("\x1b[48;5;200m bg256 \x1b[0m ");
src.write("\x1b[38;2;100;150;200mtruecolor\x1b[0m ");
src.write("日本語");
src.write("\x1b[5;20Hcursor here");
await new Promise((resolve) => src.write("", resolve));

const snapshot = serializeAddon.serialize({ scrollback: 0 });
console.log(`snapshot length: ${snapshot.length} bytes; src buffer: ${src.buffer.active.type}`);

let totalMismatches = 0;

const compare = (label, sBuf, dBuf) => {
  let mismatches = 0;
  const report = (msg) => {
    if (mismatches < 8) console.log(`  [${label}] mismatch: ${msg}`);
    mismatches++;
  };
  if (sBuf.type !== dBuf.type) report(`buffer type src=${sBuf.type} dst=${dBuf.type}`);
  if (sBuf.cursorY !== dBuf.cursorY || sBuf.cursorX !== dBuf.cursorX) {
    report(`cursor src=(${sBuf.cursorY},${sBuf.cursorX}) dst=(${dBuf.cursorY},${dBuf.cursorX})`);
  }
  for (let row = 0; row < ROWS; row++) {
    const sLine = sBuf.getLine(row);
    const dLine = dBuf.getLine(row);
    if (!sLine || !dLine) {
      if (!!sLine !== !!dLine) report(`line ${row} existence ${!!sLine}/${!!dLine}`);
      continue;
    }
    for (let col = 0; col < COLS; col++) {
      const sCell = sLine.getCell(col);
      const dCell = dLine.getCell(col);
      if (!sCell || !dCell) continue;
      if (sCell.getChars() !== dCell.getChars()) report(`chars @${row},${col}: ${JSON.stringify(sCell.getChars())} vs ${JSON.stringify(dCell.getChars())}`);
      if (sCell.getFgColorMode() !== dCell.getFgColorMode() || sCell.getFgColor() !== dCell.getFgColor()) report(`fg @${row},${col}`);
      if (sCell.getBgColorMode() !== dCell.getBgColorMode() || sCell.getBgColor() !== dCell.getBgColor()) report(`bg @${row},${col}`);
      if (sCell.isBold() !== dCell.isBold()) report(`bold @${row},${col}`);
      if (sCell.isUnderline() !== dCell.isUnderline()) report(`underline @${row},${col}`);
      if (sCell.isInverse() !== dCell.isInverse()) report(`inverse @${row},${col}`);
    }
  }
  console.log(mismatches === 0 ? `PASS [${label}]` : `FAIL [${label}]: ${mismatches} mismatches`);
  totalMismatches += mismatches;
};

// Case 1: a FRESH terminal (the snapshot/restore design case).
const dstFresh = new Terminal({ cols: COLS, rows: ROWS, scrollback: 1000, allowProposedApi: true });
await new Promise((resolve) => dstFresh.write(snapshot, resolve));
compare("fresh", src.buffer.active, dstFresh.buffer.active);

// Case 2: the render-skip case — a terminal ALREADY in the alt-screen with
// stale content that the snapshot must replace cleanly (no toggle to normal,
// no leftover pollution from the normal-buffer prefix).
const dstInAlt = new Terminal({ cols: COLS, rows: ROWS, scrollback: 1000, allowProposedApi: true });
dstInAlt.write("\x1b[?1049h\x1b[2J\x1b[H");
dstInAlt.write("STALE CONTENT THAT MUST BE OVERWRITTEN XXXXXXXX");
await new Promise((resolve) => dstInAlt.write("", resolve));
await new Promise((resolve) => dstInAlt.write(snapshot, resolve));
compare("already-in-alt", src.buffer.active, dstInAlt.buffer.active);
if (dstInAlt.buffer.active.type !== "alternate") {
  console.log(`FAIL [already-in-alt]: dst toggled out of alt-screen (type=${dstInAlt.buffer.active.type})`);
  totalMismatches++;
}

src.dispose();
dstFresh.dispose();
dstInAlt.dispose();

console.log(totalMismatches === 0 ? "ALL PASS" : `TOTAL FAILURES: ${totalMismatches}`);
process.exit(totalMismatches === 0 ? 0 : 1);
