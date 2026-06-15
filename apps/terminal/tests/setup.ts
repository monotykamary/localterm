import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vite-plus/test";

const createStore = (initial: Record<string, string> = {}): Storage => {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    key: (index) => Array.from(map.keys())[index] ?? null,
  };
};

beforeAll(() => {
  if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
    globalThis.localStorage = createStore();
  }
});

afterEach(() => {
  cleanup();
});
