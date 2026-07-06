import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus/test/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    css: false,
    tags: [{ name: "integration" }, { name: "e2e" }],
  },
});
