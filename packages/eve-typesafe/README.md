# @eve/typesafe

Typed Jev decisions, decision tools, and prompt-aware model routing for eve.
Requires Node.js 24+ and eve.

```sh
pnpm add @eve/typesafe eve
```

Set `TYPESAFE_API_KEY` on the server. Get a key from the
[TypeSafe console](https://console.typesafe.ai/); access may require approval.
Credentials are resolved at runtime, never when compiling agent definitions.

```ts
// agent/agent.ts
import { defineAgent } from "eve";
import { smartModel } from "@eve/typesafe";

export default defineAgent({
  model: smartModel({
    options: [
      ["openai/gpt-5.6-sol", "Difficult reasoning and ambiguous tasks"],
      ["openai/gpt-5.6-luna", "Routine requests where speed matters"],
    ],
    fallback: "openai/gpt-5.6-sol",
    minConfidence: 0.8,
    onError: "fallback",
  }),
});
```

```ts
// agent/tools/decide.ts
import { decisionTool } from "@eve/typesafe";

export default decisionTool();
```

Use `decide({ state, questions })` from application code. Questions use `choice`
with `options`, `score` with ordered `levels`, or `probability` for a yes/no
judgment. Every question includes a `prompt`; answers retain their uncertainty.
Jev cannot generate arbitrary text or JSON schemas.

The router selects at the first model step and reuses the result for the turn.
Use `scope: "session"` for a model retained across turns. Defaults are a 1-second
total routing deadline with no retries, and a 5-second decision/tool deadline
with one retry. Cancellation propagates without fallback. Model credentials and
eligibility remain the application's responsibility.

See [TypeSafe Decisions](https://eve.dev/docs/guides/typesafe) for the complete
API, limits, evidence projection, subagent behavior, telemetry, and failure policies.
