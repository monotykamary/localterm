const SYNCHRONIZED_OUTPUT_END_SEQUENCE = "\x1b[?2026l";
const TRAILING_PREFIX_LENGTH = SYNCHRONIZED_OUTPUT_END_SEQUENCE.length - 1;

export interface SynchronizedOutputEndDetector {
  push: (data: string) => boolean;
}

export const createSynchronizedOutputEndDetector = (): SynchronizedOutputEndDetector => {
  let trailingPrefix = "";

  return {
    push: (data) => {
      const boundaryCandidate = trailingPrefix + data.slice(0, TRAILING_PREFIX_LENGTH);
      const didEndSynchronizedOutput =
        data.includes(SYNCHRONIZED_OUTPUT_END_SEQUENCE) ||
        boundaryCandidate.includes(SYNCHRONIZED_OUTPUT_END_SEQUENCE);

      trailingPrefix =
        data.length >= TRAILING_PREFIX_LENGTH
          ? data.slice(-TRAILING_PREFIX_LENGTH)
          : (trailingPrefix + data).slice(-TRAILING_PREFIX_LENGTH);

      return didEndSynchronizedOutput;
    },
  };
};
