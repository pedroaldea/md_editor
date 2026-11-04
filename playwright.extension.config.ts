import { defineConfig } from "@playwright/test";

// Loads the unpacked Chrome extension; it needs a persistent context, so it
// runs apart from the app suite and without the Vite dev server.
export default defineConfig({
  testDir: "./tests/extension",
  timeout: 30_000,
  retries: 0,
  workers: 1
});
