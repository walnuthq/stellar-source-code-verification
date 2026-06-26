import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The /verify test drives a real `stellar contract verify` (a Docker
    // rebuild) end to end against a running api-verifier; give it generous time
    // and never run it in parallel with others.
    include: ["test/**/*.test.ts"],
    testTimeout: 330_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
