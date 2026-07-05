import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { __resetAgentModelsCache, useAgentModels } from "../../src/utils/fetch-agent-models";

const Harness = () => {
  const { models, loading } = useAgentModels();
  return <div data-testid="result" data-loading={loading} data-count={models.length} />;
};

const fetchCalledAgentModels = () =>
  vi.mocked(fetch).mock.calls.some((call) => call[0].toString().includes("/api/agent-models"));

describe("useAgentModels (SWR)", () => {
  beforeEach(() => {
    __resetAgentModelsCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/agent-models")) {
          return new Response(
            JSON.stringify({
              models: [{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads models on first mount", async () => {
    render(<Harness />);
    expect(screen.getByTestId("result").getAttribute("data-loading")).toBe("true");
    await waitFor(() =>
      expect(screen.getByTestId("result").getAttribute("data-loading")).toBe("false"),
    );
    expect(screen.getByTestId("result").getAttribute("data-count")).toBe("1");
    expect(fetchCalledAgentModels()).toBe(true);
  });

  it("serves stale models immediately and revalidates on a later mount", async () => {
    const { unmount } = render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("result").getAttribute("data-count")).toBe("1"));
    unmount();

    vi.mocked(fetch).mockClear();
    render(<Harness />);
    // Stale cache is shown instantly (no loading) ...
    expect(screen.getByTestId("result").getAttribute("data-loading")).toBe("false");
    expect(screen.getByTestId("result").getAttribute("data-count")).toBe("1");
    // ... and a background revalidate fires.
    await waitFor(() => expect(fetchCalledAgentModels()).toBe(true));
  });
});
