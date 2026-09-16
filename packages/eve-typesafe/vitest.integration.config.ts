import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "eve/tools": fileURLToPath(new URL("../eve/src/public/tools/index.ts", import.meta.url)),
      "eve/context": fileURLToPath(new URL("../eve/src/public/context/index.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["src/**/*.integration.test.ts"], testTimeout: 5000 },
});
