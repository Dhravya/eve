import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, it } from "vitest";

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const eveRoot = fileURLToPath(new URL("../../eve", import.meta.url));

it("builds an agent and child from the packed package without a build-time key", async () => {
  const root = await mkdtemp(join(tmpdir(), "eve-typesafe-package-"));
  try {
    await run("pnpm", ["pack", "--config.ignore-scripts=true", "--pack-destination", root], {
      cwd: packageRoot,
    });
    const archive = (await readdir(root)).find((entry) => entry.endsWith(".tgz"));
    expect(archive).toBeDefined();
    const app = join(root, "app");
    const installed = join(app, "node_modules/@eve/typesafe");
    await mkdir(installed, { recursive: true });
    await run("tar", ["-xf", join(root, archive!), "--strip-components=1", "-C", installed]);
    await symlink(eveRoot, join(app, "node_modules/eve"), "junction");
    const files = {
      "package.json": JSON.stringify({
        name: "typesafe-package-scenario",
        private: true,
        type: "module",
        dependencies: { eve: "*", "@eve/typesafe": "*" },
      }),
      "agent/instructions.md": "Help Alice review the export incident.",
      "agent/agent.ts": `import { defineAgent } from "eve";
import { smartModel } from "@eve/typesafe";
export default defineAgent({ model: smartModel({ options: [["openai/gpt-5.6-sol", "Investigations"], ["openai/gpt-5.6-luna", "Routine work"]] }) });`,
      "agent/tools/decide.ts": `import { decisionTool } from "@eve/typesafe";
export default decisionTool();`,
      "agent/subagents/worker/instructions.md": "Review the assigned evidence.",
      "agent/subagents/worker/agent.ts": `import { defineAgent } from "eve";
import { smartModel } from "@eve/typesafe";
export default defineAgent({ description: "Review evidence", model: smartModel({ scope: "session", options: [["openai/gpt-5.6-sol", "Investigations"]] }) });`,
    };
    for (const [name, content] of Object.entries(files)) {
      const path = join(app, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    const cli = new URL("../../eve/dist/src/cli/run.js", import.meta.url).href;
    const built = await run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const { runCli } = await import(${JSON.stringify(cli)}); await runCli(["build"]); process.exit(0);`,
      ],
      {
        cwd: app,
        env: { ...process.env, TYPESAFE_API_KEY: "" },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 90_000,
      },
    );
    expect(built.stdout).toContain("built output");
    await access(join(app, ".output/server/index.mjs"));
    await expect(access(join(installed, "src"))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
