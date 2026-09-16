import { autoModel } from "eve/experimental/typesafe";
import { defineDynamic } from "eve";
import { defineState } from "eve/context";
import { mockModel, type MockModelResponder } from "eve/evals";

export const routing = defineState("typesafe-fixture.routing", () => ({
  requests: 0,
  model: "unselected",
}));

export const typesafeFetch: typeof globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body)) as {
    state: unknown;
    questions: Record<string, { type: string; criteria?: Record<string, string> }>;
  };
  const state = JSON.stringify(body.state);
  if (body.questions.route) {
    routing.update((value) => ({ ...value, requests: value.requests + 1 }));
    if (state.includes("service unavailable")) return new Response(null, { status: 529 });
    const choice = state.includes("difficult") ? "openai/large" : "openai/small";
    return Response.json({
      model: "jev-fixture",
      answers: {
        route: {
          type: "choice",
          choice,
          confidence: 0.9,
          probabilities: Object.fromEntries(
            Object.keys(body.questions.route.criteria ?? {}).map((key) => [
              key,
              key === choice ? 1 : 0,
            ]),
          ),
        },
      },
      usage: { input_tokens: 42, output_tokens: 3 },
    });
  }
  return Response.json({
    model: "jev-fixture",
    answers: Object.fromEntries(
      Object.keys(body.questions).map((key) => [key, { type: "noul", noul: 0.95 }]),
    ),
    usage: { input_tokens: 12, output_tokens: 2 },
  });
};

/** Run the real router with authored scripted model instances. */
export function fixtureModel(respond: MockModelResponder, scope: "turn" | "session" = "turn") {
  const model = autoModel({
    options: {
      "openai/large": {
        model: mockModel({ modelId: "openai/large", respond }),
        description: "Difficult investigations",
      },
      "openai/small": {
        model: mockModel({ modelId: "openai/small", respond }),
        description: "Routine requests",
      },
    },
    apiKey: "fixture-key",
    fetch: typesafeFetch,
    scope,
    onDecision: (decision) => {
      routing.update((value) => ({ ...value, model: decision.model }));
    },
  });
  return defineDynamic({
    events: {
      "step.started": async (event, ctx) => {
        const selected = await model.events["step.started"]!(event, ctx);
        return {
          model: selected,
          modelContextWindowTokens: 1_000_000,
        };
      },
    },
  });
}
