/** True for IPv4/IPv6 loopback, including IPv4-mapped IPv6 (`::ffff:127.0.0.1`). */
export const isLoopbackRemoteAddress = (address: string): boolean => {
  const mapped = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return mapped === "127.0.0.1" || mapped === "::1" || mapped === "0:0:0:0:0:0:0:1";
};
