import { SESSIONS_PEER_FACE_PALETTE } from "@/lib/constants";

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

// facehash's string hash, ported from the library so the local avatar picks the
// same eye style facehash would for a given windowId.
const facehashStringHash = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
  }
  return Math.abs(hash);
};

// The background color for a profile's peer faces — deterministic per
// browser-profile handle (windowId) so a profile keeps one color across every
// session row. The face (a local port of facehash — eyes + first-letter mouth)
// is also seeded with the windowId, so a profile keeps one face across every row.
export const peerProfileColor = (windowId: string): string =>
  SESSIONS_PEER_FACE_PALETTE[hashString(windowId) % SESSIONS_PEER_FACE_PALETTE.length];

// Index into the ported facehash eye styles for a profile's face —
// deterministic per browser-profile handle (windowId) via facehash's hash, so a
// profile keeps one face across every row. `variantCount` is the number of eye
// styles, kept in sync with EYE_FACES in sessions-modal.
export const peerFaceIndex = (windowId: string, variantCount: number): number =>
  facehashStringHash(windowId) % variantCount;
