const formatElapsedSeconds = (elapsedMs: number): string => {
  const totalSeconds = elapsedMs / 1000;
  if (totalSeconds < 60) {
    // Floor to tenths instead of toFixed-rounding so a turn just under a
    // minute never displays as "60.0s".
    const tenths = Math.floor(totalSeconds * 10) / 10;
    return `${tenths.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
};

// Compose the OSC 9 notification body for a finished agent turn: identity +
// elapsed time. The notification's arrival already signals "finished", so the
// text carries only who (the pi session name when set, so multiple sessions
// are distinguishable) and how long. Pure: unit-testable without a session.
export const formatAgentEndBody = (elapsedMs: number, sessionName?: string): string => {
  const elapsed = formatElapsedSeconds(elapsedMs);
  return sessionName ? `pi finished: ${sessionName} (${elapsed})` : `pi finished (${elapsed})`;
};
