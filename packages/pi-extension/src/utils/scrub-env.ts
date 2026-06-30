// Remove the given env-var names from an environment object, returning a new
// object (the input is never mutated). The bash spawnHook uses this to strip
// localterm-managed secret env vars from the child process's environment so a
// command the agent generates cannot read keys the localterm shim injected into
// pi's own env. Pure: unit-testable without spawning a process.
export const scrubEnv = (env: NodeJS.ProcessEnv, strip: ReadonlySet<string>): NodeJS.ProcessEnv => {
  if (strip.size === 0) return env;
  const next: NodeJS.ProcessEnv = { ...env };
  for (const name of strip) {
    if (Object.prototype.hasOwnProperty.call(next, name)) delete next[name];
  }
  return next;
};
