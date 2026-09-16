import { access } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { runPnpmCommand } from "#internal/testing/run-pnpm-command.js";
import { useScenarioApp } from "#internal/testing/scenario-app.js";

const scenarioApp = useScenarioApp();

it("builds an agent and child using the experimental API from packed eve without a build-time key", async () => {
  const app = await scenarioApp({
    name: "experimental-typesafe",
    installDependencies: true,
    files: {
      "agent/instructions.md": "Help Alice review the export incident.",
      "agent/agent.ts": `import { defineAgent } from "eve";
import { autoModel } from "eve/experimental/typesafe";
export default defineAgent({ model: autoModel({ options: [["openai/gpt-5.6-sol", "Investigations"], ["openai/gpt-5.6-luna", "Routine work"]] }) });`,
      "agent/tools/decide.ts": `import { decisionTool } from "eve/experimental/typesafe";
export default decisionTool();`,
      "agent/subagents/worker/instructions.md": "Review the assigned evidence.",
      "agent/subagents/worker/agent.ts": `import { defineAgent } from "eve";
import { autoModel } from "eve/experimental/typesafe";
export default defineAgent({ description: "Review evidence", model: autoModel({ scope: "session", options: [["openai/gpt-5.6-sol", "Investigations"]] }) });`,
    },
  });
  const built = await runPnpmCommand({
    args: ["exec", "eve", "build"],
    cwd: app.appRoot,
    env: { ...process.env, TYPESAFE_API_KEY: "" },
  });
  expect(built.stdout).toContain("built output");
  await access(join(app.appRoot, ".output/server/index.mjs"));
  await expect(access(join(app.appRoot, "node_modules/eve/src"))).rejects.toThrow();
});
