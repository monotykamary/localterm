import { describe, expect, it } from "vite-plus/test";
import type { SessionListItem } from "@monotykamary/localterm-server/protocol";
import { buildPeerColorMap } from "../../src/utils/peer-color";

const hueOf = (color: string): number => {
  const match = /hsl\(([\d.]+)/.exec(color);
  return match ? Number(match[1]) : Number.NaN;
};

const session = (clientProfiles: { windowId: string; count: number }[]): SessionListItem => ({
  id: "00000000-0000-0000-0000-000000000001",
  pid: 1,
  shell: "/bin/sh",
  shellName: "sh",
  cwd: "/tmp",
  title: "tmp",
  createdAt: 0,
  lastOutputAt: 0,
  clients: clientProfiles.reduce((sum, profile) => sum + profile.count, 0),
  clientProfiles,
  state: "ready",
  pinned: false,
});

describe("buildPeerColorMap", () => {
  it("excludes the picker's own profile and back-compat clients with no id", () => {
    const colors = buildPeerColorMap(
      [
        session([
          { windowId: "me", count: 1 },
          { windowId: "", count: 1 },
          { windowId: "other", count: 1 },
        ]),
      ],
      "me",
    );
    expect(colors.has("me")).toBe(false);
    expect(colors.has("")).toBe(false);
    expect(colors.has("other")).toBe(true);
  });

  it("gives two other profiles well-separated, distinct hues", () => {
    const colors = buildPeerColorMap(
      [
        session([
          { windowId: "profile-a", count: 1 },
          { windowId: "profile-b", count: 1 },
        ]),
      ],
      "me",
    );
    const hueA = hueOf(colors.get("profile-a") ?? "");
    const hueB = hueOf(colors.get("profile-b") ?? "");
    expect(hueA).not.toBe(hueB);
    const separation = Math.min(Math.abs(hueA - hueB), 360 - Math.abs(hueA - hueB));
    // The golden-angle step (~137°) for the first two — far above the ~12°
    // collision a per-id hash produced, which hid a third client.
    expect(separation).toBeGreaterThan(100);
  });

  it("is deterministic for the same set of profiles", () => {
    const sessions = [
      session([
        { windowId: "profile-a", count: 2 },
        { windowId: "profile-b", count: 1 },
      ]),
    ];
    expect(buildPeerColorMap(sessions, "me")).toEqual(buildPeerColorMap(sessions, "me"));
  });

  it("collects profiles across every loaded session", () => {
    const colors = buildPeerColorMap(
      [
        session([{ windowId: "profile-a", count: 1 }]),
        session([{ windowId: "profile-b", count: 1 }]),
      ],
      "me",
    );
    expect(colors.size).toBe(2);
    expect(colors.has("profile-a")).toBe(true);
    expect(colors.has("profile-b")).toBe(true);
  });
});
