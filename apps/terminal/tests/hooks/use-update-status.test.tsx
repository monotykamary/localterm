import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useUpdateStatus } from "../../src/hooks/use-update-status";

const Harness = () => {
  const { updateAvailable, latest } = useUpdateStatus();
  return <div data-testid="result" data-available={updateAvailable} data-latest={latest ?? ""} />;
};

const stubUpdateStatus = (
  body: {
    current: string;
    latest: string | null;
    updateAvailable: boolean;
    checkedAt: number | null;
  } | null,
  status = 200,
) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/update-status")) {
        if (body === null) return new Response("down", { status: 500 });
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }),
  );

describe("useUpdateStatus", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("surfaces an available update from the daemon cache", async () => {
    stubUpdateStatus({
      current: "1.0.0",
      latest: "1.2.0",
      updateAvailable: true,
      checkedAt: 123,
    });
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId("result").getAttribute("data-available")).toBe("true"),
    );
    expect(screen.getByTestId("result").getAttribute("data-latest")).toBe("1.2.0");
  });

  it("stays quiet when already on the latest", async () => {
    stubUpdateStatus({
      current: "1.2.0",
      latest: "1.2.0",
      updateAvailable: false,
      checkedAt: 123,
    });
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId("result").getAttribute("data-available")).toBe("false"),
    );
    expect(screen.getByTestId("result").getAttribute("data-latest")).toBe("1.2.0");
  });

  it("leaves the indicator off when the daemon is unreachable", async () => {
    stubUpdateStatus(null, 500);
    render(<Harness />);
    // The immediate poll resolves to null; the indicator stays at its default.
    expect(screen.getByTestId("result").getAttribute("data-available")).toBe("false");
    expect(screen.getByTestId("result").getAttribute("data-latest")).toBe("");
    await act(async () => {});
  });
});
