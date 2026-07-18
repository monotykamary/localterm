import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const capabilityMocks = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  setCapabilities: vi.fn(),
}));

vi.mock("@earendil-works/pi-tui", () => capabilityMocks);

import { enableKittyImages } from "../extensions/kitty-images.js";

describe("enableKittyImages", () => {
  beforeEach(() => {
    capabilityMocks.getCapabilities.mockReset();
    capabilityMocks.setCapabilities.mockReset();
  });

  it("enables Kitty images and hyperlinks synchronously", () => {
    capabilityMocks.getCapabilities.mockReturnValue({
      images: null,
      trueColor: true,
      hyperlinks: false,
    });

    enableKittyImages();

    expect(capabilityMocks.setCapabilities).toHaveBeenCalledWith({
      images: "kitty",
      trueColor: true,
      hyperlinks: true,
    });
  });

  it("replaces a different image protocol with Kitty", () => {
    capabilityMocks.getCapabilities.mockReturnValue({
      images: "iterm2",
      trueColor: false,
      hyperlinks: true,
    });

    enableKittyImages();

    expect(capabilityMocks.setCapabilities).toHaveBeenCalledWith({
      images: "kitty",
      trueColor: false,
      hyperlinks: true,
    });
  });

  it("does not rewrite capabilities that are already enabled", () => {
    capabilityMocks.getCapabilities.mockReturnValue({
      images: "kitty",
      trueColor: true,
      hyperlinks: true,
    });

    enableKittyImages();

    expect(capabilityMocks.setCapabilities).not.toHaveBeenCalled();
  });
});
