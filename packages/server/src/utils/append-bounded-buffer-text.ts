export interface BoundedBufferTextAppendResult {
  text: string;
  bytes: number;
  truncated: boolean;
}

export const appendBoundedBufferText = (
  current: string,
  currentBytes: number,
  chunk: Buffer,
  maxBytes: number,
): BoundedBufferTextAppendResult => {
  const remainingBytes = maxBytes - currentBytes;
  if (remainingBytes <= 0) return { text: current, bytes: currentBytes, truncated: true };
  const captured = chunk.subarray(0, remainingBytes);
  return {
    text: current + captured.toString("utf8"),
    bytes: currentBytes + captured.length,
    truncated: chunk.length > remainingBytes,
  };
};
