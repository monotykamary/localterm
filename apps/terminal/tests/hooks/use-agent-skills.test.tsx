import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { __resetAgentSkillsCache, useAgentSkills } from "../../src/utils/fetch-agent-skills";

const Harness = ({ cwd }: { cwd: string }) => {
  const { skills, loading } = useAgentSkills(cwd);
  return (
    <div data-testid="result" data-loading={loading} data-count={skills.length} data-cwd={cwd} />
  );
};

const skillBody = (cwd: string): string =>
  JSON.stringify({
    skills: [
      {
        name: `skill-${cwd}`,
        description: `${cwd} desc`,
        disabled: false,
        source: "global-pi",
      },
    ],
  });

const calledCwds = (): string[] =>
  vi
    .mocked(fetch)
    .mock.calls.map((call) => new URL(call[0].toString()).searchParams.get("cwd") ?? "");

describe("useAgentSkills (SWR)", () => {
  beforeEach(() => {
    __resetAgentSkillsCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        const cwd = new URL(url).searchParams.get("cwd") ?? "";
        return new Response(skillBody(cwd), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads skills on first mount for the given cwd", async () => {
    render(<Harness cwd="/repo" />);
    expect(screen.getByTestId("result").getAttribute("data-loading")).toBe("true");
    await waitFor(() =>
      expect(screen.getByTestId("result").getAttribute("data-loading")).toBe("false"),
    );
    expect(screen.getByTestId("result").getAttribute("data-count")).toBe("1");
    expect(calledCwds()).toContain("/repo");
  });

  it("serves stale skills immediately and revalidates on a later mount", async () => {
    const { unmount } = render(<Harness cwd="/repo" />);
    await waitFor(() => expect(screen.getByTestId("result").getAttribute("data-count")).toBe("1"));
    unmount();

    vi.mocked(fetch).mockClear();
    render(<Harness cwd="/repo" />);
    expect(screen.getByTestId("result").getAttribute("data-loading")).toBe("false");
    expect(screen.getByTestId("result").getAttribute("data-count")).toBe("1");
    await waitFor(() => expect(calledCwds()).toContain("/repo"));
  });

  it("fetches separately for different cwds", async () => {
    render(<Harness cwd="/a" />);
    await waitFor(() => expect(screen.getByTestId("result").getAttribute("data-count")).toBe("1"));
    render(<Harness cwd="/b" />);
    await waitFor(() =>
      expect(screen.getAllByTestId("result")[1].getAttribute("data-count")).toBe("1"),
    );
    expect(calledCwds()).toEqual(expect.arrayContaining(["/a", "/b"]));
  });
});
