---
issue: "TBD (maintainer-requested research; no matching issue found)"
status: implemented
last_updated: "2026-09-16"
---

# Jev decision models in eve

## Recommendation

Provide an opt-in decision API at `eve/experimental/typesafe` inside eve, backed by
TypeSafe's Jev. Build two conveniences on it: a generic decision tool and
`autoModel`, a helper that returns an ordinary `defineDynamic` model definition.
Ship the decision tool first, then evaluate model routing on representative eve
workloads before recommending it as a default.

Jev fits the small judgments surrounding an agent: selecting a model, ranking
context, classifying work, and checking evidence. Keep planning, text generation,
and difficult reasoning with the main agent. For a critical decision, ask Jev
about specific factors and let explicit application policy determine the action.

The maintainer requested implementation as `eve/experimental/typesafe`; the decision API,
tool, and router now live there. The API is experimental and may change as
TypeSafe evolves. Other integrations remain follow-up ideas.
See [the implemented API](../docs/guides/typesafe.md) for its concrete limits and
configuration. Findings reflect TypeSafe's live documentation and eve source at
`7b17b27f4`, reviewed on
September 16, 2026. No authenticated Jev inference or independent benchmark was
run. Reported performance is vendor evidence, not a measurement of eve.

## What Jev provides

TypeSafe describes Jev as its first System One model, trained with Reinforcement
Learning for Calibrated Decisions (RLCD). It accepts natural language and
structured state, then supplies constrained decisions and probability
distributions. It does not generate prose, code, or explanations. Calibration
is a property of predictions across a dataset, not a guarantee for an individual
answer. [System One](https://docs.typesafe.ai/concepts/system-one),
[AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer).

### The three primitives

| Primitive | Question and input                                                   | Answer                                                                      | Implication for eve                                                                                                              |
| --------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Choice    | Select from named alternatives with descriptions; up to 255 options. | Winning option, probabilities across options, and confidence.               | Model, subagent, category, or candidate selection. Include a no-match outcome when needed.                                       |
| Score     | Rate one dimension using 2–10 ordered descriptions.                  | Probability-weighted position, level legend, probabilities, and confidence. | Relevance, severity, or quality. With three levels the score ranges from 0 to 2 and can be fractional.                           |
| Noul      | Evaluate a yes/no question, optionally describing both outcomes.     | Probability of yes in `[0, 1]`; no separate confidence.                     | Independent flags, verification checks, or multi-label classification. A value near 0.5 means uncertainty, not medium intensity. |

Sources: [Choice](https://docs.typesafe.ai/primitives/choice),
[Score](https://docs.typesafe.ai/primitives/score),
[Noul](https://docs.typesafe.ai/primitives/noul).

A Choice distribution compares alternatives within that question. Do not treat
its values as independent probabilities that each candidate can succeed, or
compare them across separately constructed candidate lists. For graded ranking,
use the same Score rubric per candidate; for several simultaneously applicable
labels, use separate Nouls. [Primitives](https://docs.typesafe.ai/primitives),
[re-ranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe).

### State, questions, and parallelism

Each request has one `state`: text, a JSON object, or an array. Every question
sees that same state and runs independently. Question IDs only correlate answers;
the model does not see them. Each question must therefore spell out its target,
including an item path when evaluating part of a larger state.
[State](https://docs.typesafe.ai/concepts/state),
[question authoring](https://docs.typesafe.ai/primitives).

This produces two different batching patterns:

- **Shared context:** ask many questions about one document or conversation in
  one request. This avoids paying to send the same context repeatedly.
- **Different contexts:** use bounded concurrent requests. A related collection
  can be one state with an explicit question per item, but that exposes the
  entire collection to every question and increases context size. Never combine
  unrelated tenants just to save requests.

Questions in a request cannot consume each other's answers. Speculative questions
can describe an assumed branch; code ignores the answers for branches it does not
choose. A decision that changes the evidence or available options needs a second
request. Extra questions still consume tokens.
[Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out).

Instructions and option descriptions can themselves be structured JSON. There is
some documentation unevenness: the advanced guide and SDK allow broader values
than the HTTP reference's descriptions of some fields. Start eve's public
question descriptions as nonempty strings; expand only for demonstrated needs.
[Advanced structure](https://docs.typesafe.ai/primitives/advanced).

### Confidence and reliability

Choice and Score `confidence` is a statistic derived from the probability
distribution. The confidence guide does not specify its exact formula. It is not
an independent verifier, the winning option's probability, or a calibrated
probability that an entire workflow succeeds. Preserve the distribution and
confidence separately; measure decision thresholds on labeled examples.
[Confidence](https://docs.typesafe.ai/confidence).

The launch's zero-hallucination claim concerns constrained output shape. A valid
option can still be the wrong decision. Continue validating HTTP responses, input
coverage, authorization, and downstream invariants. Narrow output space does not
make untrusted instructions harmless.
[Launch explanation](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

### Access and operational contract

| Surface     | Verified behavior                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP        | `POST https://api.typesafe.ai/v1/systemone`, bearer API key, JSON `{ model, state, questions }`.                                                                                |
| Models      | Documentation uses `jev-latest`; cookbooks pin `jev-1.12`. JavaScript `client.models.list()` returns models available to the account, with name, description, and release date. |
| Results     | `{ model, answers, usage }`; usage includes input and output token counts.                                                                                                      |
| Errors      | HTTP reference documents 401 for authentication, 422 for validation, 429 for rate limits, and 529 for overload.                                                                 |
| JavaScript  | `@typesafe-ai/sdk`, Node.js 20+, ESM/CommonJS, inferred answer types, `TypeSafeClient.systemOne()`.                                                                             |
| Python      | `typesafe-sdk`, Python 3.10+, synchronous and asynchronous clients.                                                                                                             |
| Credentials | SDKs read `TYPESAFE_API_KEY`; obtain a key from the TypeSafe console. Access is still described as early access.                                                                |

Sources: [HTTP API](https://docs.typesafe.ai/api),
[JavaScript SDK](https://docs.typesafe.ai/sdk/javascript),
[model discovery](https://docs.typesafe.ai/sdk/javascript/api/interfaces/Models),
[model metadata](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ModelCard),
[Python SDK](https://docs.typesafe.ai/sdk/python),
[quick start](https://docs.typesafe.ai/introduction/quickstart),
[launch](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

The JavaScript SDK defaults to a 10-second timeout **per attempt**, two retries,
and retries for connection/timeouts, HTTP 408, 429, and 5xx. It honors retry delay
headers and has no total retry budget. Those defaults can erase the latency
benefit of a router during an outage. Debug logging includes unredacted request
and response bodies. An eve integration needs its own total deadline and must
avoid logging decision state.
[Client configuration](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig),
[retry policy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy).

The SDK is moving quickly: v0.6.0, dated September 15, changed Score criteria from
a dictionary to an ordered sequence. Pin the transport contract and test it;
do not infer old cookbook compatibility from matching package names.
[JavaScript changelog](https://docs.typesafe.ai/sdk/javascript/changelog).

### Price and performance evidence

The launch advertises **$0.042 per million input tokens, free output tokens, and
70–500 ms end-to-end latency**. Its measurements generally originate on the West
Coast near the service. These are advertised observations, not a latency SLA or
a guarantee for an eve deployment in another region. The headline speed and cost
ratios compare selected workflows against other models, using large-model
reference probabilities rather than independently labeled truth.
[Launch and methodology](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

The parallel-questions cookbook uses `jev-1.12`, 13 questions over one document,
and five runs per strategy. It reports $0.000497 and 0.27 seconds for one batched
request, versus $0.006090 and 2.71 seconds for 13 individual requests. The 10× time
comparison sums sequential calls; concurrent requests would narrow that gap.
[Parallel questions experiment](https://docs.typesafe.ai/cookbooks/parallel_questions).

At the advertised input price, a hypothetical 2,000-token request costs
`2,000 / 1,000,000 × $0.042 = $0.000084`, or $84 per million requests. This assumes
2,000 **total billed input tokens**, including questions and criteria, and excludes
retries. Actual usage must drive accounting. Routing is economical only when its
cost plus the selected model's cost and any escalation is lower than the baseline
at an acceptable task-success rate.

## Where this fits in eve today

| Existing surface                                                                                | What it enables or constrains                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`defineTool`](../docs/tools/overview.mdx)                                                      | An opt-in decision tool with validated inputs and turn cancellation. Its path supplies its name.                                                |
| [`defineDynamic`](../packages/eve/src/dynamic/definition.ts)                                    | Async resolver handlers with session identity, channel metadata, effective model, and visible messages.                                         |
| [Dynamic model lifecycle](../packages/eve/src/context/dynamic-model-lifecycle.ts)               | Session, turn, and step selections, with step > turn > session precedence. Every handler must return a concrete model; invalid selections fail. |
| [`defineState`](../docs/concepts/state.md)                                                      | Durable session-local storage for a selected route. Children have their own state.                                                              |
| [Model normalization](../packages/eve/src/runtime/agent/resolve-model.ts)                       | Existing validation and metadata resolution for the actual selected LLM. Jev should not duplicate this.                                         |
| [Dynamic subagent configuration](../packages/eve/src/runtime/subagents/dynamic-agent-config.ts) | A dynamically returned `defineAgent` must contain a static model. Nesting `autoModel` in that returned config would fail.                       |
| [Hooks](../docs/guides/hooks.md)                                                                | Observe-only lifecycle subscribers, suitable for evaluation and telemetry; not an interception point that can retract streamed output.          |

There is a timing detail behind prompt-aware routing. The
[turn preamble](../packages/eve/src/harness/emission.ts) emits session/turn events
without message arguments. The [event sink](../packages/eve/src/execution/session/event-sink.ts)
passes lifecycle messages to resolvers, but the
[memory lifecycle](../packages/eve/src/context/memory-event-lifecycle.ts) returns an
empty list when no messages or memory providers supply them. Memory recall can
supply the incoming turn at `turn.started`; routing must not depend on configuring
memory. These events therefore do not consistently expose the incoming prompt.

By contrast, the [tool loop](../packages/eve/src/harness/tool-loop.ts) invokes the
step model resolver with projected messages after preparing turn input and before
model-dependent compaction or inference. Use that boundary for `autoModel` and
retain its decision for the desired scope. No new resolver event is needed.

## Proposed decision API and generic tool

Use an eve-owned `eve/experimental/typesafe` entry point with `decide`, `decisionTool`, and
`autoModel`. The first implementation speaks TypeSafe HTTP internally. Public
schemas, result types, errors, and policy belong to eve; do not re-export SDK
types or make Jev pretend to implement a conversational `LanguageModel`.

The decision schema is an explicit finite question map. It is **not arbitrary
JSON Schema**: unrestricted strings, arrays, and numbers cannot be generated by
Jev. A future schema adapter could translate enums and booleans, but should reject
unsupported shapes rather than quietly calling another LLM. Candidate extraction
can separately find spans in code and let Jev choose among them.
[Closed-set function calling](https://docs.typesafe.ai/cookbooks/function_calling),
[value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook).

Proposed authored usage:

```ts
import { decide } from "eve/experimental/typesafe";

const result = await decide({
  model: "jev-latest",
  state: {
    request: "Alice reports that exports fail for every workspace.",
    evidence: "Bob reproduced the failure in three workspaces; rollback is available.",
  },
  questions: {
    impact: {
      type: "score",
      prompt: "How broadly does the export failure affect users?",
      levels: ["One user", "Several users", "Every workspace"],
    },
    reproduced: {
      type: "probability",
      prompt: "Does the supplied evidence include an independently reproduced failure?",
    },
    nextStep: {
      type: "choice",
      prompt: "Which investigation step best fits the supplied evidence?",
      options: {
        inspectRelease: "Inspect the latest release for a shared export regression.",
        requestReproduction: "Request a reproducible example when evidence is missing.",
        escalate: "Have a specialist assess an ambiguous incident.",
      },
    },
  },
});

const nextStep = result.answers.nextStep;
```

Each answer retains a discriminant and a `value`: an option key for Choice, a
fractional level position for Score, and a yes-probability for Probability.
Choice/Score also preserve `probabilities` and `confidence`; Score preserves its
level mapping. Return the provider model and token usage once per request.
Static question maps infer the corresponding answer keys and option unions.
Map eve's `probability` question to TypeSafe's Noul internally; do not synthesize
an extra confidence field or threshold it into a boolean automatically.

The generic tool is a file the author opts into:

```ts
// agent/tools/decide.ts
import { decisionTool } from "eve/experimental/typesafe";

export default decisionTool({ model: "jev-latest" });
```

Its model-facing arguments are `{ state, questions }` using the same finite
schema. The main agent supplies the context and questions at call time; the tool
returns all answers in one result. The API key, endpoint, provider model, and
resource limits remain author-controlled. The tool is named `decide` from its
path, with no redundant `name` configuration.

The tool description should ask for narrow, independent judgments, include all
necessary evidence, encourage shared-state batching, and explain uncertainty.
For repeated business decisions, prefer a purpose-specific tool with an authored
rubric: an agent-generated rubric can omit an important factor or change the
meaning between calls. Decision output is advice until application code applies
it; the generic tool does not execute the action it selected.

Bound state bytes, JSON depth, question count, option count, response size, and
concurrency. Enforce the known 255-option and 2–10-level limits locally. Choose
additional eve limits from measured workloads; the reviewed reference does not
publish a total question limit or context window. Do not silently truncate
critical evidence or silently split a request whose questions need the full state.

## Proposed `autoModel`

Use a keyed options map with model IDs as shorthand and explicit provider models
under aliases. The helper returns a reusable dynamic-model definition:

```ts
// agent/agent.ts
import { defineAgent } from "eve";
import { autoModel } from "eve/experimental/typesafe";

export default defineAgent({
  model: autoModel({
    options: {
      "openai/gpt-5.6-sol": "For difficult reasoning and ambiguous engineering problems",
      "openai/gpt-5.6-luna": "For routine requests where fast completion matters",
    },
  }),
});
```

String values describe the model ID used as the option key. An object value
`{ model: anthropic("sonnet-5"), description: "Routine work" }` under a custom key
returns that provider instance. Only keys and descriptions go to Jev; only the
selected key and decision metadata are persisted. Eligibility, fallback, and
observation refer to option keys.

These are illustrative model identifiers, not a claim that both
are available in every AI Gateway account. Validate the selected model through
eve's normal runtime catalog and credential path.

### Selection semantics

1. `autoModel` returns a `defineDynamic` definition with a `step.started`
   handler. Construction validates configuration but performs no network access
   or credential lookup during compilation.
2. On the first step of each turn, build a bounded decision state from the latest
   user request and relevant recent text. Preserve role labels; omit credentials,
   auth objects, raw attachments, and unrelated tool output. Detect nontext inputs
   for eligibility checks rather than claiming Jev can interpret their bytes.
   Offer an authored `state(ctx)` override for domain-specific context.
3. Ask one Choice question using the supplied descriptions as routing criteria.
   Add a no-fit option internally; accept 1–254 configured option keys to
   stay within Jev's 255-option limit. Fail if no eligible model remains.
   Descriptions must describe actual task fit;
   Jev cannot infer current model quality or price from a model ID alone.
4. Validate the answer, apply the uncertainty policy, and return an allowlisted
   model ID or provider instance through eve's existing normalization. Check known
   modality, context, and application constraints before selection. Where metadata
   is insufficient, require the author to supply a compatible candidate set.
5. Persist the selected option key and decision metadata in session-local state,
   keyed by turn and helper configuration. Resolve that key to its authored model
   on subsequent step events without another Jev request. Never keep mutable selection in module-global state.

Proposed default scope is `"turn"`, meaning one decision at the first step of a
turn, not a `turn.started` callback. Offer `scope: "session"` to keep the first
selection for the session, especially for a short-lived subagent. Defer automatic
step-by-step rerouting: it adds calls, model churn, and prompt-cache misses.

If new input arrives as steering within an existing turn, retain the route unless
it violates a hard capability constraint, in which case fail with an actionable
error. The next ordinary turn can reconsider.
A future explicit escalation policy can change this; v1 should not infer one.

### Uncertainty and failures

The options-only form uses the winning eligible option. A no-fit answer, malformed
result, or request failure throws; there is no implicit default model. Production
routing should provide an evaluated confidence threshold and explicit fallback:

```ts
import { autoModel } from "eve/experimental/typesafe";

export const routedModel = autoModel({
  options: {
    "openai/gpt-5.6-sol": "Difficult or ambiguous tasks",
    "openai/gpt-5.6-luna": "Routine tasks with clear requirements",
  },
  fallback: { model: "openai/gpt-5.6-sol", minConfidence: 0.8, onUnavailable: true },
  timeoutMs: 1000,
  scope: "turn",
});
```

The threshold and deadline above are illustrative tuning values. The fallback
`model` must be one of the eligible configured options and handles no-fit
answers; `minConfidence` extends it to low-confidence answers and
`onUnavailable` to transient transport failure or deadline expiry. Grouping
these under one `fallback` object makes the dependency structural: there is no
threshold or outage policy without a model to fall back to. Invalid
configuration, missing credentials, and invalid provider responses remain
actionable errors. Turn cancellation always propagates and never selects a
fallback. No branch may return `null` or invent confidence for a fallback result.

Cache the successful selection or explicit transient-failure fallback for the
turn so an outage does not trigger another router attempt on every step. Record
whether selection came from Jev, uncertainty fallback, or transport fallback.
Selecting a fallback inside the handler preserves eve's resolver-only contract;
it does not introduce a compiled placeholder model.

### Main agents and subagents

Use the same helper in the root's `agent.ts` or in a statically authored declared
subagent's `agent.ts`, typically with `scope: "session"` for the child. The child
routes against its delegated prompt, using its own state. This targets each
parallel task independently without asking the parent to predict its model.

Distinguish that from a subagent whose entire configuration is dynamically
returned by a parent-side resolver. That returned configuration currently rejects
a dynamic `model`. Such a resolver can call `decide` and return a concrete model,
but it cannot see a future delegation prompt that has not been created. Prefer a
statically authored child with `autoModel` for prompt-specific selection. A
remote agent must configure routing in its own runtime.

Model switching can re-ingest conversation history at uncached prices. A cheap
routing call is not sufficient evidence of total savings. Compare a model kept
for the whole session with one chosen per turn, and include compaction and
retries in the result. [Existing model scope contract](../docs/agent-config.md#choose-the-model-dynamically).

## Other integrations worth exploring

| Integration                                 | eve composition                                                                                           | Recommendation                                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select useful skills and tools              | Score or classify an authorized candidate list, then expose a subset through dynamic capabilities.        | High potential for large catalogs. Include no-match, retain essential recovery tools, and never interpret relevance as authorization.                                         |
| Rerank memory and retrieved evidence        | Use a custom memory provider or retrieval tool to score candidates before returning bounded context.      | Strong second use case after routing. Keep retrieval access checks and citation provenance in code.                                                                           |
| Verify cheap-model output before escalation | Generate a candidate, assess narrow evidence checks with Jev, then ask a stronger model only when needed. | Promising for structured extraction and bounded tasks. Start as an authored workflow or tool; streaming chat output cannot be retroactively withheld by an observe-only hook. |
| Route directly to deterministic work        | A channel or application ingress classifies intent and dispatches a lookup, workflow, or agent.           | Can save the whole LLM call. Keep auth and dispatch explicit; a model selector alone cannot return “run this function.”                                                       |
| Evaluate runs and classify failures         | Add Jev-backed eval judges or observe-only analysis of completed traces.                                  | Low impact starting experiment. Store rubric versions and compare with human labels; deterministic CI assertions remain the authority.                                        |
| Semantic checks before actions              | A purpose-specific tool evaluates policy factors, then enforces deterministic checks before execution.    | Opt-in only. Jev must not grant permissions or replace eve's existing approval and authorization logic.                                                                       |
| Select extracted values or taxonomy paths   | Code proposes spans or bounded candidates; Jev chooses, scores, or traverses a hierarchy.                 | Useful library recipes on top of `decide`; no new core capability needed.                                                                                                     |

These directions have concrete TypeSafe examples: [skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion),
[RAG passage classification](https://docs.typesafe.ai/cookbooks/classifying_rag_passages),
[citation verification](https://docs.typesafe.ai/cookbooks/citation_check),
[extraction cascades](https://docs.typesafe.ai/cookbooks/sde_cascade),
[intent routing](https://docs.typesafe.ai/patterns/intent-routing),
[guardrails](https://docs.typesafe.ai/cookbooks/llm_guardrails), and
[hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification).
The cascade cookbook includes an illustrative hard-coded extraction failure;
its demonstration is not an independent end-to-end reliability result.

## Runtime boundaries

Keep the integration in `packages/eve/src/experimental/typesafe`, using eve internal APIs.
Prefer a small internal HTTP adapter using existing fetch, validation, and error
utilities. If SDK behavior is worth reusing, vendor pinned implementation under
a development dependency; avoid adding a runtime dependency or exposing SDK
classes. No new compiler sentinel, generated runtime behavior, or general routing
framework is warranted for v1.

The shared adapter owns request/response validation, authentication, a bounded
retry policy, cancellation, total deadlines, and metadata reporting. The tool
passes its existing `ctx.abortSignal`. Dynamic model resolution now forwards the
active cancellation signal through an optional `DynamicResolveContext.abortSignal`.
The router combines it with its total deadline, so cancellation stops selection
without choosing an outage fallback.

Reuse existing workflow durability. Once a decision and its state commit, resume
from that value. A crash before commit may repeat inference and billing; the
reviewed API does not establish an idempotency guarantee. Do not promise exactly
one provider call. Generic tool decisions do not require a global cache; any
future cache must include tenant, state, question, model, and rubric identity.

Instrument each provider attempt and logical decision with duration, selected
model, question count, usage, policy version, and outcome. Keep Jev usage distinct
from the selected LLM's usage: a raw HTTP call is not automatically an LLM model
step. Use bounded metadata and existing trace conventions; never store raw
prompts, credentials, or user records in ordinary logs.

## Validation and rollout

The implementation includes `decide`, the opt-in tool, and `autoModel` over
one adapter, with published documentation and a patch changeset.

- **Unit:** question validation and inferred types; answer keys, option membership,
  finite probabilities, distributions, and score bounds; route thresholds,
  allowlists, no-fit, and error policy.
- **Integration:** fake transport tests for deadlines, retries, cancellation,
  malformed payloads, state reuse, and tenant/session separation. Assert a later
  step reuses its route and a later turn reevaluates it.
- **Scenario:** compile an agent and declared child from the packed eve package
  without a build-time key. Runtime prompt availability and independent child
  selection are exercised by the CI fixture.
- **CI e2e:** deterministic fixture evals for the tool, routing, failure paths, and
  parallel child behavior, using a self-contained mock Jev transport. Existing
  LLM mock mode alone does not intercept a new TypeSafe HTTP call. Keep live Jev
  credentials out of required e2e.
- **Quality experiment:** separately run labeled, consented workloads against
  pinned Jev and fixed routing baselines. Measure task success, false cheap-model
  selections, fallback rate, calibration, total spend, and p50/p95/p99 latency.
  Include short/long sessions, ambiguous follow-ups, nontext inputs, parallel
  work, and service failures. Compare batching against both sequential and
  concurrent individual requests.

Set rollout thresholds from that experiment. Expose routing opt-in first, observe
its decisions without applying them when collecting baseline evidence, then
activate it for workloads where measured savings preserve the required quality.

## Questions to resolve before production support

The reviewed documentation does not establish the context window, maximum total
questions/request bytes, account concurrency and rate quotas, regional latency
commitments, API data retention/training policy, version support lifetime, or
idempotency semantics. Confirm these with TypeSafe before promising production
limits. Account model discovery can verify a pin is available; it does not expose
those operational guarantees.

Also validate the exact confidence calculation and target-domain calibration,
whether structured question descriptions behave consistently across API and SDK
versions, and the actual Jev model behind `jev-latest`. Published inputs are text
and JSON; do not advertise image or audio inference based on a use-case list.

The strongest initial scope is a finite-question decision tool plus an explicit,
measured model router. Skill selection, retrieval ranking, and verification can
then reuse the same API without expanding eve's execution core.
