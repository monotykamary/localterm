import { describe, expect, it } from "vite-plus/test";
import { SESSIONS_PEER_FACE_PALETTE } from "../../src/lib/constants";
import { peerFaceIndex, peerProfileColor } from "../../src/utils/peer-avatar";

describe("peerProfileColor", () => {
  it("is deterministic per window id", () => {
    const windowId = "fa072b42-4719-44ba-afb9-95b730faa59d";
    expect(peerProfileColor(windowId)).toBe(peerProfileColor(windowId));
  });

  it("returns a palette color for any id", () => {
    expect(SESSIONS_PEER_FACE_PALETTE).toContain(
      peerProfileColor("ff1108f0-947d-496a-8886-b2145962deb9"),
    );
  });

  it("falls back to the first palette entry for the empty back-compat id", () => {
    expect(peerProfileColor("")).toBe(SESSIONS_PEER_FACE_PALETTE[0]);
  });
});

describe("peerFaceIndex", () => {
  it("is deterministic and stays within the variant count", () => {
    const windowId = "d1b2fcb5-0000-0000-0000-000000000000";
    expect(peerFaceIndex(windowId, 4)).toBe(peerFaceIndex(windowId, 4));
    expect(peerFaceIndex(windowId, 4)).toBeGreaterThanOrEqual(0);
    expect(peerFaceIndex(windowId, 4)).toBeLessThan(4);
  });

  it("matches facehash's hash for a known id (CrossFace = index 1)", () => {
    expect(peerFaceIndex("d1b2fcb5-0000-0000-0000-000000000000", 4)).toBe(1);
  });
});
