import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Run test files sequentially – each suite spins up its own in-memory DB
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,
  },
});
