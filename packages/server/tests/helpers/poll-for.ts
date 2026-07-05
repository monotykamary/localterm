// Poll a boolean condition until it's true or the timeout elapses. Replaces
// fixed `await wait(N)` before an assertion that depends on a timer/event
// firing — those fail under event-loop load when the timer fires later than N.
// `pollFor` waits until the condition holds (up to timeoutMs), so a loaded
// machine just waits longer instead of failing.
export const pollFor = async (
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
  intervalMs = 20,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return await condition();
};
