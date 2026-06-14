import { describe, expect, it } from "vite-plus/test";
import {
  CaffeinateController,
  type CaffeinateProcessHandle,
} from "../src/caffeinate-controller.js";

interface FakeProcess extends CaffeinateProcessHandle {
  killed: boolean;
  triggerExit: () => void;
}

const createFakeSpawn = () => {
  const spawned: FakeProcess[] = [];
  const spawnProcess = (): CaffeinateProcessHandle => {
    let exitListener: (() => void) | null = null;
    const fake: FakeProcess = {
      killed: false,
      kill: () => {
        fake.killed = true;
      },
      onExit: (listener) => {
        exitListener = listener;
      },
      triggerExit: () => exitListener?.(),
    };
    spawned.push(fake);
    return fake;
  };
  return { spawned, spawnProcess };
};

const countChanges = (controller: CaffeinateController) => {
  let changes = 0;
  controller.on("change", () => {
    changes += 1;
  });
  return () => changes;
};

describe("CaffeinateController", () => {
  it("spawns one keep-awake process when enabled", () => {
    const { spawned, spawnProcess } = createFakeSpawn();
    const controller = new CaffeinateController({ supported: true, spawnProcess });
    const changes = countChanges(controller);

    controller.setActive(true);

    expect(controller.active).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(changes()).toBe(1);
  });

  it("is idempotent — enabling twice spawns only one process", () => {
    const { spawned, spawnProcess } = createFakeSpawn();
    const controller = new CaffeinateController({ supported: true, spawnProcess });
    const changes = countChanges(controller);

    controller.setActive(true);
    controller.setActive(true);

    expect(spawned).toHaveLength(1);
    expect(changes()).toBe(1);
  });

  it("kills the process when disabled", () => {
    const { spawned, spawnProcess } = createFakeSpawn();
    const controller = new CaffeinateController({ supported: true, spawnProcess });
    const changes = countChanges(controller);

    controller.setActive(true);
    controller.setActive(false);

    expect(controller.active).toBe(false);
    expect(spawned[0].killed).toBe(true);
    expect(changes()).toBe(2);
  });

  it("no-ops on unsupported platforms", () => {
    const { spawned, spawnProcess } = createFakeSpawn();
    const controller = new CaffeinateController({ supported: false, spawnProcess });
    const changes = countChanges(controller);

    controller.setActive(true);

    expect(controller.supported).toBe(false);
    expect(controller.active).toBe(false);
    expect(spawned).toHaveLength(0);
    expect(changes()).toBe(0);
  });

  it("flips inactive and emits change when the process dies unexpectedly", () => {
    const { spawned, spawnProcess } = createFakeSpawn();
    const controller = new CaffeinateController({ supported: true, spawnProcess });
    const changes = countChanges(controller);

    controller.setActive(true);
    spawned[0].triggerExit();

    expect(controller.active).toBe(false);
    expect(changes()).toBe(2);
  });

  it("ignores the exit of a process it already stopped", () => {
    const { spawned, spawnProcess } = createFakeSpawn();
    const controller = new CaffeinateController({ supported: true, spawnProcess });

    controller.setActive(true);
    controller.setActive(false);
    const changes = countChanges(controller);
    spawned[0].triggerExit();

    expect(changes()).toBe(0);
    expect(controller.active).toBe(false);
  });

  it("kills the active process on dispose", () => {
    const { spawned, spawnProcess } = createFakeSpawn();
    const controller = new CaffeinateController({ supported: true, spawnProcess });

    controller.setActive(true);
    controller.dispose();

    expect(spawned[0].killed).toBe(true);
    expect(controller.active).toBe(false);
  });
});
