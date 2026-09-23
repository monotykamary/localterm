import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getDiffFileContents, peekDiffFileContents } from "../../src/utils/diff-file-contents";
import { parseUnifiedDiff } from "../../src/utils/parse-unified-diff";
import {
  getCachedDiffSyntaxTokens,
  requestDiffSyntaxTokens,
} from "../../src/utils/syntax-highlight";
import {
  clearSyntaxTokenCache,
  materializeEntryTokens,
} from "../../src/utils/syntax-token-manager";

vi.mock("../../src/utils/diff-file-contents", () => ({
  getDiffFileContents: vi.fn(),
  peekDiffFileContents: vi.fn(),
}));

const oldText = "law add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}";
const newText = "law add_zero:\n  for +x: Nat\n  {Nat.add(x, 0n) == x : Nat}";
const patch = [
  "@@ -1,3 +1,3 @@",
  " law add_zero:",
  "-  for x: Nat",
  "+  for +x: Nat",
  "   {Nat.add(x, 0n) == x : Nat}",
].join("\n");
const options = {
  cwd: "/project",
  filePath: "LAWS.bend",
  query: { mode: "working" as const },
  patch,
  priority: 0,
};

describe("Bend diff syntax highlighting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearSyntaxTokenCache();
    vi.mocked(getDiffFileContents).mockResolvedValue(null);
  });

  it.each(["LAWS.bend", "src/main.bend", "PROOF.BEND"])(
    "detects %s and colors both sides in both themes",
    async (filePath) => {
      const model = await requestDiffSyntaxTokens({ ...options, filePath });
      expect(model).not.toBeNull();
      if (!model) throw new Error("Bend language was not detected");
      expect(model.entry.compact).not.toBeNull();
      for (const scheme of ["dark", "light"] as const) {
        const tokens = materializeEntryTokens(model.entry, scheme);
        for (const [side, source] of [
          [tokens.old, oldText],
          [tokens.next, newText],
        ] as const) {
          expect(
            side?.map((line) => line?.tokens.map((token) => token.content).join("")).join("\n"),
          ).toBe(source);
          expect(
            new Set(side?.flatMap((line) => line?.tokens.map((token) => token.color) ?? [])).size,
          ).toBeGreaterThan(2);
        }
      }
      expect(model.entry.compact?.next?.dark.palette).not.toEqual(
        model.entry.compact?.next?.light.palette,
      );
    },
  );

  it("uses full documents and serves the highlighted entry from the synchronous cache", async () => {
    const contents = {
      path: options.filePath,
      oldContent: oldText,
      newContent: newText,
      oldTruncated: false,
      newTruncated: false,
    };
    vi.mocked(getDiffFileContents).mockResolvedValue(contents);
    vi.mocked(peekDiffFileContents).mockReturnValue(contents);
    const model = await requestDiffSyntaxTokens(options);
    expect(model?.entry.compact).toBeTruthy();
    const cached = getCachedDiffSyntaxTokens({ ...options, hunks: parseUnifiedDiff(patch) });
    expect(cached?.entry).toBe(model?.entry);
    expect(cached?.targets).toEqual(model?.targets);
  });

  it("continues to leave unknown extensions unhighlighted", async () => {
    expect(await requestDiffSyntaxTokens({ ...options, filePath: "main.unknown" })).toBeNull();
    expect(getDiffFileContents).not.toHaveBeenCalled();
  });
});
