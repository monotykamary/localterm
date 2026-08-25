const ESCAPE = "\x1b";
const STRING_TERMINATOR = "\\";
const BELL = "\x07";

enum ApcState {
  Ground,
  Escape,
  Data,
  DataEscape,
}

interface ReplayChunk {
  data: string;
  startsAtSafeBoundary: boolean;
}

export class TerminalReplayBuffer {
  private readonly chunks: ReplayChunk[] = [];
  private byteLength = 0;
  private apcState = ApcState.Ground;

  constructor(private readonly maximumBytes: number) {}

  append(data: string): void {
    if (!data) return;
    const startsAtSafeBoundary = this.apcState === ApcState.Ground;
    this.advanceApcState(data);
    this.chunks.push({ data, startsAtSafeBoundary });
    this.byteLength += Buffer.byteLength(data, "utf8");

    while (this.byteLength > this.maximumBytes && this.chunks.length > 1) {
      this.dropOldest();
    }
    while (this.chunks[0] && !this.chunks[0].startsAtSafeBoundary) {
      this.dropOldest();
    }
  }

  snapshot(): string {
    return this.chunks.map(({ data }) => data).join("");
  }

  private dropOldest(): void {
    const dropped = this.chunks.shift();
    if (dropped) this.byteLength -= Buffer.byteLength(dropped.data, "utf8");
  }

  private advanceApcState(data: string): void {
    for (const character of data) {
      if (this.apcState === ApcState.Ground) {
        if (character === ESCAPE) this.apcState = ApcState.Escape;
        continue;
      }
      if (this.apcState === ApcState.Escape) {
        this.apcState =
          character === "_"
            ? ApcState.Data
            : character === ESCAPE
              ? ApcState.Escape
              : ApcState.Ground;
        continue;
      }
      if (this.apcState === ApcState.Data) {
        if (character === BELL) this.apcState = ApcState.Ground;
        else if (character === ESCAPE) this.apcState = ApcState.DataEscape;
        continue;
      }
      this.apcState =
        character === STRING_TERMINATOR
          ? ApcState.Ground
          : character === ESCAPE
            ? ApcState.DataEscape
            : ApcState.Data;
    }
  }
}
