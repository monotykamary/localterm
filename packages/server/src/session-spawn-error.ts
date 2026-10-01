export class SessionSpawnError extends Error {
  constructor(cause: unknown) {
    super("Failed to start shell; terminal resources may be exhausted. See daemon log.", { cause });
    this.name = "SessionSpawnError";
  }
}
