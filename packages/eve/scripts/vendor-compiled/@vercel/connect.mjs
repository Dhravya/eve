import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDeclaration } from "../_shared.mjs";

const require = createRequire(import.meta.url);
const connectTokenEntry = join(dirname(require.resolve("@vercel/connect")), "token.js");
const CONNECT_TOKEN_MODULE_ID = "eve:vercel-connect-token";

const resolveConnectToken = {
  name: "eve:resolve-vercel-connect-token",
  resolveId(source) {
    if (source === CONNECT_TOKEN_MODULE_ID) return connectTokenEntry;
    if (source === "@vercel/oidc") {
      return { id: "#compiled/@vercel/oidc/index.js", external: true };
    }
    return null;
  },
};

/** Vendor only the core token helper self-modification uses. */
const wrapperEntry = fileURLToPath(
  new URL("./entries/@vercel/connect.mjs", new URL("../", import.meta.url)),
);

export default {
  packageName: "@vercel/connect",
  compiledPath: "@vercel/connect",
  bundling: "standalone",
  entries: [
    {
      input: wrapperEntry,
      outputPath: "index",
      declaration: await loadDeclaration("@vercel/connect.d.ts"),
    },
  ],
  plugins: [resolveConnectToken],
};
