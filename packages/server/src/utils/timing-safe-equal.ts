import { timingSafeEqual } from "node:crypto";

// Constant-time string equality for comparing a secret received over the
// network (a bearer token) against the expected value, so a remote caller
// can't time the comparison to recover it byte-by-byte. `timingSafeEqual`
// throws on mismatched Buffer lengths, so the length guard short-circuits
// first — which is fine: the length is not secret here.
export const timingSafeEqualString = (received: string, expected: string): boolean => {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
  );
};
