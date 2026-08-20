import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  preview: {
    port: 1421,
    strictPort: true
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/@lezer")) {
            return "codemirror";
          }
          if (id.includes("node_modules/highlight.js")) {
            return "syntax-highlight";
          }
          if (id.includes("node_modules/pdfjs-dist")) {
            return "pdfjs";
          }
          if (id.includes("node_modules/marked") || id.includes("node_modules/dompurify")) {
            return "markdown-runtime";
          }
          // Let Rollup keep optional dynamic imports separate. A catch-all vendor
          // chunk would pull the lazy Mermaid runtime into every app startup.
          return undefined;
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"]
  }
});
