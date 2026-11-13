import { defineConfig } from "vitest/config";
import path from "node:path";

// Browser journeys (npm run test:e2e). Needs a built app (next build) and tests/e2e/setup.ts run first.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", include: ["tests/e2e/**/*.e2e.ts"], fileParallelism: false, testTimeout: 60_000, hookTimeout: 120_000 },
});
