const SYNCHRONIZED_OUTPUT_CONTROL_PREFIX = "\x1b[?2026";
const SYNCHRONIZED_OUTPUT_START_FINAL = "h";
const SYNCHRONIZED_OUTPUT_END_FINAL = "l";
const SYNCHRONIZED_OUTPUT_SEQUENCE_LENGTH = SYNCHRONIZED_OUTPUT_CONTROL_PREFIX.length + 1;
const TRAILING_PREFIX_LENGTH = SYNCHRONIZED_OUTPUT_SEQUENCE_LENGTH - 1;

export interface SynchronizedOutputEndDetector {
  isActive: () => boolean;
  push: (data: string) => boolean;
}

export const createSynchronizedOutputEndDetector = (): SynchronizedOutputEndDetector => {
  let synchronizedOutputActive = false;
  let trailingPrefix = "";

  return {
    isActive: () => synchronizedOutputActive,
    push: (data) => {
      const candidate = trailingPrefix + data;
      let didEndSynchronizedOutput = false;
      let controlIndex = candidate.indexOf(SYNCHRONIZED_OUTPUT_CONTROL_PREFIX);

      while (controlIndex !== -1) {
        const finalCharacter = candidate[controlIndex + SYNCHRONIZED_OUTPUT_CONTROL_PREFIX.length];
        if (finalCharacter === SYNCHRONIZED_OUTPUT_START_FINAL) {
          synchronizedOutputActive = true;
        } else if (finalCharacter === SYNCHRONIZED_OUTPUT_END_FINAL) {
          synchronizedOutputActive = false;
          didEndSynchronizedOutput = true;
        }
        controlIndex = candidate.indexOf(SYNCHRONIZED_OUTPUT_CONTROL_PREFIX, controlIndex + 1);
      }

      trailingPrefix = candidate.slice(-TRAILING_PREFIX_LENGTH);
      return didEndSynchronizedOutput;
    },
  };
};
