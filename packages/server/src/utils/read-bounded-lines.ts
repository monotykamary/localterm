import fs from "node:fs";

export interface ReadBoundedLinesOptions {
  maxLineBytes: number;
  onLine: (line: string) => void;
}

export const readBoundedLines = async (
  filePath: string,
  { maxLineBytes, onLine }: ReadBoundedLinesOptions,
): Promise<void> => {
  const boundedLineBytes = Math.max(1, Math.floor(maxLineBytes));
  const stream = fs.createReadStream(filePath);
  let lineChunks: Buffer[] = [];
  let lineBytes = 0;
  let skippingOversizedLine = false;

  const emitLine = (): void => {
    if (!skippingOversizedLine && lineBytes > 0) {
      const decoded = Buffer.concat(lineChunks, lineBytes).toString("utf8");
      const line = decoded.endsWith(String.fromCharCode(13)) ? decoded.slice(0, -1) : decoded;
      onLine(line);
    }
    lineChunks = [];
    lineBytes = 0;
    skippingOversizedLine = false;
  };

  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let segmentStart = 0;
    while (segmentStart < chunk.length) {
      const newline = chunk.indexOf(0x0a, segmentStart);
      const segmentEnd = newline < 0 ? chunk.length : newline;
      const segment = chunk.subarray(segmentStart, segmentEnd);
      if (!skippingOversizedLine) {
        if (lineBytes + segment.length <= boundedLineBytes) {
          if (segment.length > 0) lineChunks.push(segment);
          lineBytes += segment.length;
        } else {
          lineChunks = [];
          lineBytes = 0;
          skippingOversizedLine = true;
        }
      }
      if (newline < 0) break;
      emitLine();
      segmentStart = newline + 1;
    }
  }
  if (lineBytes > 0 || skippingOversizedLine) emitLine();
};
