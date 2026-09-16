import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { DecisionAnswer, DecisionRequest, DecisionResult } from "./types.js";
import { boundedJson, parseResult, validateInput, wireQuestions } from "./validation.js";

const questions = {
  route: {
    type: "choice",
    prompt: "Who handles this?",
    options: { alice: "Alice owns exports", bob: "Bob owns imports" },
  },
  severity: { type: "score", prompt: "How severe?", levels: ["Cosmetic", "Blocking"] },
  reproduced: { type: "probability", prompt: "Was it reproduced?" },
} as const;

export function response() {
  return {
    model: "jev-1.12",
    answers: {
      route: {
        type: "choice",
        choice: "alice",
        probabilities: { alice: 0.9, bob: 0.1 },
        confidence: 0.8,
      },
      severity: {
        type: "score",
        score: 0.75,
        probabilities: { "0": 0.25, "1": 0.75 },
        legend: { "0": "Cosmetic", "1": "Blocking" },
        confidence: 0.6,
      },
      reproduced: { type: "noul", noul: 0.95 },
    },
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

describe("decision contracts", () => {
  it("preserves option unions and distinct probabilistic results", () => {
    const value = parseResult(response(), questions, 10);
    expectTypeOf(value.answers.route.value).toEqualTypeOf<"alice" | "bob">();
    expectTypeOf(value.answers.reproduced).toEqualTypeOf<
      DecisionAnswer<typeof questions.reproduced>
    >();
    expectTypeOf<DecisionRequest<typeof questions>["questions"]>().toEqualTypeOf<
      typeof questions
    >();
    expectTypeOf<
      DecisionResult<typeof questions>["answers"]["severity"]["value"]
    >().toEqualTypeOf<number>();
    expect(value.answers.severity.value).toBe(0.75);
    expect(value.answers.reproduced).toEqual({ type: "probability", value: 0.95 });
    expect(value.usage).toEqual({ inputTokens: 100, outputTokens: 10 });
    expect(wireQuestions(questions).reproduced).toEqual({
      type: "noul",
      instructions: "Was it reproduced?",
    });
  });

  it.each([
    // eslint-disable-next-line unicorn/no-new-array -- Sparse slots are the regression under test.
    { value: new Array(1) },
    // eslint-disable-next-line unicorn/no-new-array -- Sparse slots are the regression under test.
    { value: new Array(1_000_000) },
    { value: [null, Array.from({ length: 20_000 }, () => null)] },
  ])("rejects sparse or over-budget arrays before serialization", ({ value }) => {
    const stringify = vi.spyOn(JSON, "stringify");
    let error: unknown;
    let calls: number;
    try {
      boundedJson(value);
    } catch (caught) {
      error = caught;
    } finally {
      calls = stringify.mock.calls.length;
      stringify.mockRestore();
    }
    expect(error).toMatchObject({ code: "input" });
    expect(calls).toBe(0);
  });

  it("accepts dense arrays within the value budget", () => {
    const value = Array.from({ length: 19_999 }, () => null);
    expect(boundedJson(value)).toBe(JSON.stringify(value));
  });

  it.each([
    {},
    { state: "a", questions: {} },
    { state: "a", questions: { a: { type: "score", prompt: "How severe?", levels: ["Only"] } } },
    { state: "a", questions: { a: { type: "choice", prompt: "Pick", options: {} } } },
    { state: "a", questions: { a: { type: "probability", prompt: "", confidence: 1 } } },
    {
      state: "a",
      questions: Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => [i, questions.reproduced]),
      ),
    },
  ])("rejects unsupported or unbounded question inputs", (input) => {
    expect(() => validateInput(input)).toThrow();
  });

  it("rejects circular, non-JSON, deep, oversized, and non-finite state", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    let deep: unknown = "leaf";
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    for (const value of [
      circular,
      deep,
      new Date(),
      NaN,
      Infinity,
      undefined,
      { fn: () => 1 },
      "😀".repeat(40_000),
    ]) {
      expect(() => boundedJson(value)).toThrow();
    }
  });

  it.each([
    (v: ReturnType<typeof response>) => {
      v.answers.route.choice = "outside";
    },
    (v: ReturnType<typeof response>) => {
      v.answers.route.choice = "bob";
    },
    (v: ReturnType<typeof response>) => {
      v.answers.route.probabilities.alice = -1;
    },
    (v: ReturnType<typeof response>) => {
      v.answers.route.probabilities.bob = 1;
    },
    (v: ReturnType<typeof response>) => {
      v.answers.route.confidence = NaN;
    },
    (v: ReturnType<typeof response>) => {
      v.answers.severity.score = 3;
    },
    (v: ReturnType<typeof response>) => {
      v.answers.severity.legend["0"] = "Unrelated";
    },
    (v: ReturnType<typeof response>) => {
      v.answers.reproduced.noul = Infinity;
    },
    (v: ReturnType<typeof response>) => {
      v.usage.input_tokens = -1;
    },
  ])("rejects invalid provider answers", (mutate) => {
    const value = response();
    mutate(value);
    expect(() => parseResult(value, questions, 1)).toThrow("invalid decision response");
  });

  it("requires exactly the requested answer and distribution keys", () => {
    const value = response();
    expect(() =>
      parseResult({ ...value, answers: { ...value.answers, extra: {} } }, questions, 0),
    ).toThrow();
    expect(() =>
      parseResult({ ...value, answers: { route: value.answers.route } }, questions, 0),
    ).toThrow();
  });

  it("rejects scores that contradict the distribution", () => {
    const value = response();
    value.answers.severity.score = 0;
    value.answers.severity.probabilities = { "0": 0, "1": 1 };
    expect(() => parseResult(value, questions, 0)).toThrow("invalid decision response");
  });

  it.each([0.745, 0.755])(
    "accepts rounded scores (%s) and preserves the provider value",
    (score) => {
      const value = response();
      value.answers.severity.score = score;
      expect(parseResult(value, questions, 0).answers.severity.value).toBe(score);
    },
  );

  it("scales rounding tolerance to the score range", () => {
    const levels = ["None", "Low", "Medium", "High", "Critical"];
    const value = {
      ...response(),
      answers: {
        severity: {
          type: "score",
          score: 3.01,
          probabilities: { "0": 0.25, "1": 0, "2": 0, "3": 0, "4": 0.75 },
          legend: Object.fromEntries(levels.map((level, index) => [index, level])),
          confidence: 0.6,
        },
      },
    };
    const requested = { severity: { type: "score", prompt: "How severe?", levels } } as const;
    expect(parseResult(value, requested, 0).answers.severity.value).toBe(3.01);
    value.answers.severity.score = 3.05;
    expect(() => parseResult(value, requested, 0)).toThrow("invalid decision response");
  });
});
