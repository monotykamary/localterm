import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SecretsModal } from "../../src/components/secrets-modal";

const mocks = vi.hoisted(() => ({
  fetchProcesses: vi.fn(),
  fetchSecrets: vi.fn(),
}));

vi.mock("../../src/utils/fetch-processes", () => ({
  deleteProcess: vi.fn(),
  fetchProcesses: mocks.fetchProcesses,
  putProcess: vi.fn(),
}));

vi.mock("../../src/utils/fetch-secrets", () => ({
  deleteSecret: vi.fn(),
  exportSecrets: vi.fn(),
  fetchSecrets: mocks.fetchSecrets,
  importSecrets: vi.fn(),
  putSecret: vi.fn(),
}));

describe("SecretsModal", () => {
  beforeEach(() => {
    mocks.fetchProcesses.mockResolvedValue([]);
    mocks.fetchSecrets.mockResolvedValue({ supported: true, secrets: [] });
  });

  afterEach(cleanup);

  it("preserves the search query after rerendering", async () => {
    render(<SecretsModal open onClose={() => {}} />);

    const searchInput = await screen.findByRole("textbox", { name: "search secrets" });
    fireEvent.change(searchInput, { target: { value: "api" } });

    expect(Reflect.get(searchInput, "value")).toBe("api");
    expect(screen.getByText("No secrets match your search.")).toBeDefined();
  });

  it("keeps the secret form open while editing", async () => {
    render(<SecretsModal open onClose={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "New secret" }));
    const environmentVariableInput = screen.getByRole("textbox", {
      name: "environment variable name",
    });
    fireEvent.change(environmentVariableInput, { target: { value: "API_KEY" } });

    expect(Reflect.get(environmentVariableInput, "value")).toBe("API_KEY");
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });
});
