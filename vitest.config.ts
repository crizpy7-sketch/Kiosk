import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one Postgres database; running files in parallel
    // would have them clobbering each other's rows.
    fileParallelism: false,
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // `import "server-only"` throws outside a React Server Component context.
      // Integration tests exercise those modules directly, so it is stubbed.
      "server-only": resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
