import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.scenario.test.ts"], testTimeout: 120_000 },
});
