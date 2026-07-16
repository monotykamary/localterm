import { describe, expect, it, vi } from "vite-plus/test";
import { dispatchTerminalMouseTap } from "../../src/utils/dispatch-terminal-mouse-tap";

describe("dispatchTerminalMouseTap", () => {
  it("dispatches one bubbling left-button press and release at the touch coordinates", () => {
    const parent = document.createElement("div");
    const target = document.createElement("div");
    parent.appendChild(target);
    document.body.appendChild(parent);
    const events: MouseEvent[] = [];
    parent.addEventListener("mousedown", (event) => events.push(event));
    parent.addEventListener("mouseup", (event) => events.push(event));
    const documentMouseUp = vi.fn();
    document.addEventListener("mouseup", documentMouseUp, { once: true });

    dispatchTerminalMouseTap(target, { clientX: 120, clientY: 45 });

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(["mousedown", "mouseup"]);
    expect(events[0]).toMatchObject({
      clientX: 120,
      clientY: 45,
      button: 0,
      buttons: 1,
    });
    expect(events[1]).toMatchObject({
      clientX: 120,
      clientY: 45,
      button: 0,
      buttons: 0,
    });
    expect(documentMouseUp).toHaveBeenCalledOnce();
    parent.remove();
  });
});
