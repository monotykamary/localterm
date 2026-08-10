import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3417",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:3417",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  // Module workers keep the syntax worker code-split (per-language chunks load
  // on demand instead of one multi-MB IIFE); supported iOS 15+/Safari 15+.
  worker: {
    format: "es",
  },
});
