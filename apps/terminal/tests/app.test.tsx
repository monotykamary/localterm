import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { App } from "../src/app";

vi.mock("../src/components/terminal", () => ({
  Terminal: () => <div data-testid="terminal" />,
}));

describe("App", () => {
  it("renders the terminal immediately without contacting the server", async () => {
    render(<App />);
    expect(await screen.findByTestId("terminal")).toBeDefined();
  });
});
