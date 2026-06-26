import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The real-verification test spawns `stellar contract verify` (Docker
    // rebuild) and polls; give it generous time and never run it in parallel
    // with others sharing the same DB.
    include: ["test/**/*.test.ts"],
    testTimeout: 330_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
