// Read a passphrase from a TTY without echoing it, so an interactively-typed
// passphrase isn't left in the terminal scrollback (the way `-p <value>` would
// also be visible to `ps`). Mirrors the "values never on the command line"
// stance `secret set -v -` takes for secret values. Throws when stdin isn't an
// interactive TTY (piped) — the caller should use `-p -` (stdin) or `-p <value>`
// in that case.

const isInteractiveTty = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);

const readHidden = (prompt: string): Promise<string> =>
  new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    const bytes: number[] = [];
    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        // Enter submits.
        if (byte === 0x0d || byte === 0x0a) return finish();
        // Ctrl-C: restore the terminal before dying so the shell isn't left in
        // raw mode without echo.
        if (byte === 0x03) {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        // Ctrl-D submits only when the line is empty (EOF convention).
        if (byte === 0x04 && bytes.length === 0) return finish();
        // Backspace / delete: drop the last byte and rub it out on screen.
        if (byte === 0x7f || byte === 0x08) {
          if (bytes.length > 0) {
            bytes.pop();
            process.stdout.write("\b \b");
          }
          continue;
        }
        bytes.push(byte);
        process.stdout.write("*");
      }
    };
    const finish = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(Buffer.from(bytes).toString("utf8"));
    };
    stdin.on("data", onData);
  });

export const readPassphraseFromTty = async (
  prompt: string,
  confirmPrompt?: string,
): Promise<string> => {
  if (!isInteractiveTty()) {
    throw new Error(
      "no interactive terminal — pass the passphrase with `-p -` (stdin) or `-p <value>`",
    );
  }
  const first = await readHidden(prompt);
  if (!confirmPrompt) return first;
  const second = await readHidden(confirmPrompt);
  if (first !== second) throw new Error("passphrases did not match");
  return first;
};
