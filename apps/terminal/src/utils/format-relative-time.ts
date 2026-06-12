const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const formatMagnitude = (deltaMs: number): string => {
  if (deltaMs < MS_PER_MINUTE) return "<1m";
  if (deltaMs < MS_PER_HOUR) return `${Math.floor(deltaMs / MS_PER_MINUTE)}m`;
  if (deltaMs < MS_PER_DAY) return `${Math.floor(deltaMs / MS_PER_HOUR)}h`;
  return `${Math.floor(deltaMs / MS_PER_DAY)}d`;
};

export const formatRelativeTime = (timestampMs: number, nowMs: number): string => {
  const deltaMs = timestampMs - nowMs;
  if (deltaMs >= 0) return `in ${formatMagnitude(deltaMs)}`;
  return `${formatMagnitude(-deltaMs)} ago`;
};
