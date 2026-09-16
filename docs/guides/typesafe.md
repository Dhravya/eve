---
title: "TypeSafe Decisions"
description: "Use Jev for typed decisions, batched judgment tools, and prompt-aware model routing with @eve/typesafe."
---

`@eve/typesafe` adds Jev decisions to eve. Use `decide` from application code,
`decisionTool` when an agent should ask questions, and `smartModel` to select an
LLM from an authored list. The package owns its types and talks directly to the
TypeSafe API; it does not install the TypeSafe SDK.

## Install and authenticate

```sh
pnpm add @eve/typesafe eve
```

Get an API key from the [TypeSafe console](https://console.typesafe.ai/) and set
`TYPESAFE_API_KEY` in the server environment. Jev access may require early-access
approval. Keys are read when a request runs, so agent compilation does not require
a key. You can also pass `apiKey: () => loadYourSecret()` to any helper. Keep keys
out of model-facing tool arguments and browser code.

The default decision model is `jev-latest`. Pass `model` to select an available
Jev version. With `smartModel`, `model` identifies the **decision model**;
`options` identifies the LLMs that Jev chooses between. Those LLMs still require
their normal [model authentication](../agent-config).

## Ask typed questions

```ts
import { decide } from "@eve/typesafe";

const result = await decide({
  state: {
    request: "Alice reports that exports fail.",
    evidence: "Bob reproduced the failure in three workspaces.",
  },
  questions: {
    nextStep: {
      type: "choice",
      prompt: "Which investigation step fits the supplied evidence?",
      options: {
        inspect: "Inspect the export implementation for a shared regression.",
        reproduce: "Request a reproduction when the evidence is insufficient.",
      },
    },
    impact: {
      type: "score",
      prompt: "How broadly does the failure affect users?",
      levels: ["One user", "Several workspaces", "Every workspace"],
    },
    reproduced: {
      type: "probability",
      prompt: "Does the evidence describe an independently reproduced failure?",
    },
  },
});

const nextStep = result.answers.nextStep.value;
// nextStep is typed as "inspect" | "reproduce".
```

| Question      | Answer                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `choice`      | `value` is an option key; `probabilities` contains every option; `confidence` measures distribution concentration.                                                |
| `score`       | `value` is a fractional position from zero through `levels.length - 1`; `levels` maps indices to descriptions; `probabilities` and `confidence` remain available. |
| `probability` | `value` is the probability of yes in `[0, 1]`. There is no separate confidence value. This maps to TypeSafe's Noul primitive.                                     |

The result also includes `model`, `usage.inputTokens`, `usage.outputTokens`, and
`durationMs`. Retain uncertainty when composing decisions. A valid output is not
proof that a judgment is correct or that an action is authorized.

Each request evaluates all questions independently against the same state. Batch
questions about one document together. Use bounded concurrent requests for
unrelated documents; there is no implicit cross-session batching. Questions
cannot refer to another question's answer. Question IDs are not sent to the
model, so put the complete meaning in `prompt`.

Jev selects from finite alternatives and evaluates described dimensions. It does
not generate arbitrary strings, code, or unrestricted JSON Schema output.

## Give an agent the decision tool

```ts title="agent/tools/decide.ts"
import { decisionTool } from "@eve/typesafe";

export default decisionTool();
```

The filename gives the tool its name. The agent supplies `{ state, questions }`
with the same question shapes as `decide`. The author controls credentials,
provider model, transport, deadline, and retries. Tool cancellation cancels the
request. For recurring business decisions, wrap `decide` in a purpose-specific
[tool](../tools) with an authored rubric.

## Select a model from the prompt

```ts title="agent/agent.ts"
import { defineAgent } from "eve";
import { smartModel } from "@eve/typesafe";

export default defineAgent({
  model: smartModel({
    options: [
      ["openai/gpt-5.6-sol", "Difficult reasoning and ambiguous engineering tasks"],
      ["openai/gpt-5.6-luna", "Routine tasks where fast completion matters"],
    ],
    minConfidence: 0.8,
    fallback: "openai/gpt-5.6-sol",
    onError: "fallback",
  }),
});
```

Use model IDs available to your provider account. Descriptions supply the routing
criteria; Jev does not look up current model prices or capabilities. The threshold
above is an example, not a universal setting. Evaluate it against your tasks.

`smartModel` returns an ordinary [dynamic model definition](./dynamic-capabilities).
It reads the first `step.started` context, chooses once per turn, and stores the
result in [session state](../concepts/state). Later tool-loop steps reuse the
selection without another Jev call. `scope: "session"` retains the initial model
across turns. Session and turn lifecycle events can precede the incoming prompt,
which is why the helper selects at the first step instead.

Use the same helper in a statically authored declared subagent's `agent.ts`, with
`scope: "session"` when it should retain its initial model. Each child receives its
own prompt and state. A parent-side dynamic subagent resolver cannot return a
configuration containing `smartModel`: returned subagent configurations require
a static model. See [subagents](../subagents).

### Evidence and eligibility

By default, the router sends up to eight recent user/assistant text messages,
with role labels, within 16,000 characters. It excludes system messages, tool
results, nontext parts, and auth/channel objects. It does not redact secrets
embedded in user text. A single latest text message over the limit fails rather
than being silently truncated. Supply `state(ctx)` to project approved evidence
or a bounded summary for your application.

Use `eligible(model, ctx)` for deterministic application constraints. It runs on
every step and must return a boolean. Filter for required modalities, context
capacity, tenancy, and model access using metadata your application knows.
The helper does not perform model capability discovery. Image or file parts
require an explicit eligibility callback; Jev does not inspect their bytes.

If no option is eligible, or a retained model becomes ineligible, routing fails.
It does not switch models silently in the middle of a turn. Steering within the
same turn retains the current route; the next turn can reconsider it. Switching
models between turns can lose prompt-cache savings, so compare total task cost
with a static-model baseline.

### Uncertainty, errors, and observation

The options-only form uses the winning option and fails if Jev selects its
internal no-fit option. `fallback` must name a configured, eligible option and
handles no-fit answers. `minConfidence` additionally handles answers below a
threshold and requires a fallback.

`onError: "fallback"` separately allows fallback on transient service failures
or deadline expiry. Authentication, invalid configuration, rejected requests,
invalid responses, and cancellation do not fall back. Otherwise errors propagate
through eve's normal dynamic model failure path. A fallback is retained for the
scope, so an outage does not cause another attempt on every step.

`onDecision(decision)` runs for fresh selections, including fallbacks. It receives
`model`, `source` (`decision`, `uncertainty`, or `unavailable`), and `durationMs`.
Successful Jev responses also include `answer`, `usage`, and `decisionModel`.
No prompt, state, or credentials are included. The callback may be asynchronous;
its failure fails selection. Use it for your telemetry without confusing Jev
usage with the selected LLM's usage.

Persisted selections survive step boundaries. A crash before persistence can
repeat inference and billing; the package does not promise exactly-once requests.

## Limits and transport options

| Setting         | Behavior                                                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeoutMs`     | Total deadline, including credential lookup, retries, and body reads. Default: 5000 ms for `decide`/`decisionTool`, 1000 ms for `smartModel`. Range: 1–60000 ms. Router state projection is included; the observation callback is outside the provider deadline. |
| `maxRetries`    | Additional attempts for connection failures, HTTP 408, 429, and 5xx, including 529. Default: one for decisions/tools, zero for routing. Maximum: two. Retry headers are honored within the deadline.                                                             |
| `signal`        | Caller cancellation for `decide`. The tool and router use eve's active cancellation signal.                                                                                                                                                                      |
| `fetch`         | Trusted server-side fetch override for transport configuration and deterministic tests. The endpoint remains `https://api.typesafe.ai/v1/systemone`; redirects are rejected.                                                                                     |
| Request limits  | 1–64 questions, 128 KiB of serialized JSON, 16 nesting levels, and 20000 traversed values. These are package limits, not advertised TypeSafe quotas.                                                                                                             |
| Question limits | Prompts: 8192 characters. Descriptions: 4096 characters. Choice: 1–255 options. Score: 2–10 levels. `smartModel`: 1–254 unique model IDs, reserving one option for no-fit.                                                                                       |
| Response limit  | 1 MiB, with answer keys, types, option membership, probability distributions, confidence, score bounds, and usage validated.                                                                                                                                     |

`DecisionError` exposes a safe `code` and optional HTTP `status`. Codes are
`configuration`, `input`, `authentication`, `request`, `unavailable`, `timeout`,
`response`, and `routing`. Provider response bodies and transport exceptions are
not copied into these errors. Caller cancellation preserves the abort reason.

For TypeSafe's current model availability, primitives, and service details, see
its [documentation](https://docs.typesafe.ai/introduction).
