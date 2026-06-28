import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PortsModal } from "../../src/components/ports-modal";
import type { ListeningPort } from "@monotykamary/localterm-server/protocol";

const mocks = vi.hoisted(() => ({
  fetchPorts: vi.fn(),
  killPort: vi.fn(),
}));

vi.mock("../../src/utils/fetch-ports", () => ({
  fetchPorts: mocks.fetchPorts,
  killPort: mocks.killPort,
}));

const buildPort = (overrides: Partial<ListeningPort> = {}): ListeningPort => ({
  port: 5173,
  address: "*",
  pid: 4242,
  processName: "node",
  sessionId: "00000000-0000-0000-0000-000000000001",
  sessionTitle: "my-app",
  cwd: "/home/me/my-app",
  ...overrides,
});

afterEach(cleanup);

describe("PortsModal", () => {
  beforeEach(() => {
    mocks.fetchPorts.mockReset();
    mocks.killPort.mockReset();
    mocks.killPort.mockResolvedValue(true);
  });

  it("lists the daemon's open dev ports", async () => {
    mocks.fetchPorts.mockResolvedValue([
      buildPort({ port: 5173, pid: 4242, processName: "node", sessionTitle: "my-app" }),
      buildPort({ port: 8000, pid: 4243, processName: "python3", sessionTitle: "api" }),
    ]);
    render(<PortsModal open isTouchDevice={false} onClose={() => {}} />);

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("5173");
    expect(options[1].textContent).toContain("8000");
  });

  it("filters ports by the search query", async () => {
    mocks.fetchPorts.mockResolvedValue([
      buildPort({ port: 5173, pid: 4242, processName: "node" }),
      buildPort({ port: 8000, pid: 4243, processName: "python3" }),
    ]);
    render(<PortsModal open isTouchDevice={false} onClose={() => {}} />);

    await screen.findAllByRole("option");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5173" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("5173");
  });

  it("shows an empty state when no ports are listening", async () => {
    mocks.fetchPorts.mockResolvedValue([]);
    render(<PortsModal open isTouchDevice={false} onClose={() => {}} />);

    expect(await screen.findByText(/no listening dev ports/i)).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("shows a header spinner (not a body spinner) while the fetch is pending", async () => {
    let resolveFetch: (value: ListeningPort[]) => void = () => {};
    mocks.fetchPorts.mockImplementation(
      () =>
        new Promise<ListeningPort[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    render(<PortsModal open isTouchDevice={false} onClose={() => {}} />);

    // The small loading spinner lives in the header while the fetch is pending;
    // the body stays empty (no options, no centered spinner that then swaps for
    // the list — the flash the worktrees modal avoids the same way).
    expect(await screen.findByRole("status", { name: "loading ports" })).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    resolveFetch([buildPort()]);
    await screen.findAllByRole("option");
  });

  it("stops a port when its kill button is clicked and refetches", async () => {
    mocks.fetchPorts.mockResolvedValue([buildPort({ port: 5173, pid: 4242, processName: "node" })]);
    render(<PortsModal open isTouchDevice={false} onClose={() => {}} />);

    await screen.findAllByRole("option");
    fireEvent.click(screen.getByRole("button", { name: /stop node on port 5173/i }));

    await waitFor(() => expect(mocks.killPort).toHaveBeenCalledWith(4242));
    // Once on open, once after the kill refetches.
    await waitFor(() => expect(mocks.fetchPorts).toHaveBeenCalledTimes(2));
  });

  it("stops the highlighted port on Enter", async () => {
    mocks.fetchPorts.mockResolvedValue([buildPort({ port: 5173, pid: 4242, processName: "node" })]);
    render(<PortsModal open isTouchDevice={false} onClose={() => {}} />);

    await screen.findAllByRole("option");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    await waitFor(() => expect(mocks.killPort).toHaveBeenCalledWith(4242));
  });

  it("hides the keyboard hints on a touch device", async () => {
    mocks.fetchPorts.mockResolvedValue([buildPort()]);
    render(<PortsModal open isTouchDevice onClose={() => {}} />);

    await screen.findAllByRole("option");
    expect(screen.queryByText("navigate")).toBeNull();
    expect(screen.queryByText("stop")).toBeNull();
  });

  it("closes on Escape", async () => {
    mocks.fetchPorts.mockResolvedValue([buildPort()]);
    const onClose = vi.fn();
    render(<PortsModal open isTouchDevice={false} onClose={onClose} />);

    await screen.findAllByRole("option");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
