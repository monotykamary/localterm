export const isValidTimeZone = (timezone: string): boolean => {
  // Newer Intl implementations also accept numeric offsets; the contract is a
  // named IANA zone (including UTC and compatibility aliases), not an offset.
  if (!timezone || timezone.trim() !== timezone || /^[+-]/.test(timezone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};
