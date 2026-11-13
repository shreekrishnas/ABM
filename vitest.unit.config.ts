import { defineConfig } from "vitest/config";
import path from "node:path";

// The checks that need no database: they run inside every build (scripts/gate.mjs), so a change
// that breaks them never deploys. Add a file here only if it never touches the database.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: [
      "tests/unit.test.ts", "tests/live.test.ts", "tests/brain-editor.test.ts", "tests/opportunities.test.ts", "tests/http-retry.test.ts",
      "tests/precision.test.ts", "tests/jobs-feed.test.ts", "tests/api-auth.test.ts", "tests/auth.test.ts", "tests/why-now-text.test.ts",
      "tests/logo.test.ts", "tests/word-count.test.ts",
    ],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30000,
  },
});
