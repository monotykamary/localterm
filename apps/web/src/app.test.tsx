import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import * as api from "./lib/api";
import type { SessionMetadata } from "./lib/types";

vi.mock("./components/terminal", () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => <div data-testid="terminal">{sessionId}</div>,
}));

const makeSession = (id: string): SessionMetadata => ({
  id,
  title: id,
  cwd: "/tmp",
  shell: "/bin/sh",
  pid: 1,
  cols: 80,
  rows: 24,
  createdAt: 0,
  exited: false,
  exitCode: null,
});

const setUrl = (search: string) => {
  window.history.replaceState({}, "", `/${search}`);
};

const currentSearchParam = (key: string): string | null =>
  new URL(window.location.href).searchParams.get(key);

beforeEach(() => {
  setUrl("");
});

afterEach(() => {
  vi.restoreAllMocks();
  setUrl("");
});

describe("App", () => {
  it("creates a session when the URL has no id, then writes ?id= back", async () => {
    const create = vi.spyOn(api, "createSession").mockResolvedValue(makeSession("alpha"));

    render(<App />);

    expect(await screen.findByTestId("terminal")).toHaveTextContent("alpha");
    expect(create).toHaveBeenCalledTimes(1);
    expect(currentSearchParam("id")).toBe("alpha");
  });

  it("uses the URL's ?id= without contacting the server", async () => {
    setUrl("?id=existing");
    const create = vi.spyOn(api, "createSession");

    render(<App />);

    expect(await screen.findByTestId("terminal")).toHaveTextContent("existing");
    expect(create).not.toHaveBeenCalled();
    expect(currentSearchParam("id")).toBe("existing");
  });

  it("upgrades the legacy ?tab= URL to ?id= without creating a session", async () => {
    setUrl("?tab=legacy");
    const create = vi.spyOn(api, "createSession");

    render(<App />);

    expect(await screen.findByTestId("terminal")).toHaveTextContent("legacy");
    expect(create).not.toHaveBeenCalled();
    expect(currentSearchParam("id")).toBe("legacy");
    expect(currentSearchParam("tab")).toBeNull();
  });

  it("renders a static error notice when bootstrap fails", async () => {
    vi.spyOn(api, "createSession").mockRejectedValue(new Error("server down"));

    render(<App />);

    expect(await screen.findByText(/cannot reach localterm/)).toBeInTheDocument();
    expect(screen.getByText(/server down/)).toBeInTheDocument();
  });

  it("registers a beforeunload listener once a session is live", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    vi.spyOn(api, "createSession").mockResolvedValue(makeSession("alpha"));

    render(<App />);

    await screen.findByTestId("terminal");
    await waitFor(() => {
      const wasRegistered = addSpy.mock.calls.some(([eventName]) => eventName === "beforeunload");
      expect(wasRegistered).toBe(true);
    });
  });
});
