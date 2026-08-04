import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useKeyboardLockPermission } from "../../src/hooks/use-keyboard-lock-permission";

class FakePermissionStatus extends EventTarget {
  state: PermissionState;

  constructor(state: PermissionState) {
    super();
    this.state = state;
  }
}

const originalPermissions = navigator.permissions;

const installPermissions = (permissionStatus: FakePermissionStatus) => {
  const query = vi.fn(() => Promise.resolve(permissionStatus));
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query },
  });
  return query;
};

describe("useKeyboardLockPermission", () => {
  afterEach(() => {
    if (originalPermissions === undefined) Reflect.deleteProperty(navigator, "permissions");
    else {
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: originalPermissions,
      });
    }
  });

  it("tracks a denied Keyboard Lock site permission and refreshes on focus", async () => {
    const permissionStatus = new FakePermissionStatus("denied");
    const query = installPermissions(permissionStatus);
    const { result } = renderHook(() => useKeyboardLockPermission());

    await waitFor(() => expect(result.current.permissionState).toBe("denied"));
    expect(query).toHaveBeenCalledWith({ name: "keyboard-lock" });

    permissionStatus.state = "granted";
    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(result.current.permissionState).toBe("granted"));
  });

  it("re-queries after a lock failure", async () => {
    const permissionStatus = new FakePermissionStatus("prompt");
    const query = installPermissions(permissionStatus);
    const { result } = renderHook(() => useKeyboardLockPermission());
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));

    act(() => result.current.refreshPermissionState());

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  });
});
