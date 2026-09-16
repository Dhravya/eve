import { DecisionError } from "./errors.js";
import type { DecisionConfig, DecisionInput, DecisionQuestions, DecisionResult } from "./types.js";

export const MAX_REQUEST_BYTES = 131_072;
export const MAX_RESPONSE_BYTES = 1_048_576;
export const MAX_QUESTIONS = 64;

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 8192): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function validateConfig(config: DecisionConfig): void {
  if (
    (config.model !== undefined && !text(config.model, 256)) ||
    (config.apiKey !== undefined &&
      typeof config.apiKey !== "string" &&
      typeof config.apiKey !== "function") ||
    (config.fetch !== undefined && typeof config.fetch !== "function") ||
    (config.timeoutMs !== undefined &&
      (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 60_000)) ||
    (config.maxRetries !== undefined &&
      (!Number.isInteger(config.maxRetries) || config.maxRetries < 0 || config.maxRetries > 2))
  ) {
    throw new DecisionError(
      "configuration",
      "Invalid TypeSafe configuration: use a model ID, a 1–60000 ms deadline, and 0–2 retries.",
    );
  }
}

/** Bound traversal before serialization so caller-supplied state cannot grow work without limit. */
export function boundedJson(value: unknown): string {
  let nodes = 0;
  let characters = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (++nodes > 20_000 || depth > 16 || characters > MAX_REQUEST_BYTES) fail();
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item === "string") {
      characters += item.length;
      if (characters > MAX_REQUEST_BYTES) fail();
      return;
    }
    if (typeof item !== "object" || ancestors.has(item)) fail();
    const container = item as object;
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      fail();
    ancestors.add(container);
    if (Array.isArray(item)) {
      if (item.length > 20_000 - nodes) fail();
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(item, index)) fail();
      }
    }
    for (const [key, child] of Object.entries(container)) {
      characters += key.length;
      visit(child, depth + 1);
    }
    ancestors.delete(container);
  }
  function fail(): never {
    throw new DecisionError(
      "input",
      "Decision data must be finite JSON within 128 KiB, 16 levels, and 20000 values.",
    );
  }
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > MAX_REQUEST_BYTES) fail();
  return encoded;
}

export function validateInput(input: unknown): asserts input is DecisionInput {
  if (
    !object(input) ||
    !(typeof input.state === "string" || object(input.state) || Array.isArray(input.state)) ||
    !object(input.questions)
  ) {
    throw new DecisionError("input", "Pass a text or JSON state and a nonempty questions map.");
  }
  boundedJson({ state: input.state, questions: input.questions });
  const entries = Object.entries(input.questions);
  if (entries.length < 1 || entries.length > MAX_QUESTIONS)
    throw new DecisionError("input", "A decision request requires 1–64 questions.");
  for (const [id, question] of entries) {
    if (!text(id, 256) || !object(question) || !text(question.prompt))
      throw new DecisionError(
        "input",
        "Each question needs a nonempty ID and prompt (maximum 8192 characters).",
      );
    const keys =
      question.type === "choice"
        ? ["type", "prompt", "options"]
        : question.type === "score"
          ? ["type", "prompt", "levels"]
          : ["type", "prompt"];
    if (Object.keys(question).some((key) => !keys.includes(key)))
      throw new DecisionError("input", "Question contains unsupported fields.");
    if (question.type === "choice") {
      if (!object(question.options))
        throw new DecisionError("input", "Choice options must map keys to descriptions.");
      const options = Object.entries(question.options);
      if (
        options.length < 1 ||
        options.length > 255 ||
        options.some(([key, description]) => !text(key, 256) || !text(description, 4096))
      )
        throw new DecisionError(
          "input",
          "A choice requires 1–255 options with nonempty keys and descriptions.",
        );
    } else if (question.type === "score") {
      if (
        !Array.isArray(question.levels) ||
        question.levels.length < 2 ||
        question.levels.length > 10 ||
        question.levels.some((level) => !text(level, 4096))
      )
        throw new DecisionError("input", "A score requires 2–10 nonempty level descriptions.");
    } else if (question.type !== "probability") {
      throw new DecisionError("input", "Question type must be choice, score, or probability.");
    }
  }
}

export function wireQuestions(questions: DecisionQuestions): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
      id,
      {
        type: question.type === "probability" ? "noul" : question.type,
        instructions: question.prompt,
        ...(question.type === "choice"
          ? { criteria: question.options }
          : question.type === "score"
            ? { criteria: question.levels }
            : {}),
      },
    ]),
  );
}

export function parseResult<Q extends DecisionQuestions>(
  value: unknown,
  questions: Q,
  durationMs: number,
): DecisionResult<Q> {
  function fail(): never {
    throw new DecisionError("response", "TypeSafe returned an invalid decision response.");
  }
  function probability(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail();
    return value;
  }
  function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return (
      Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
    );
  }
  function distribution(value: unknown, keys: readonly string[]): Record<string, number> {
    if (!object(value) || !sameKeys(value, keys)) fail();
    const entries = Object.entries(value).map(([key, p]) => [key, probability(p)] as const);
    if (Math.abs(entries.reduce((sum, [, p]) => sum + p, 0) - 1) > 0.01) fail();
    return Object.fromEntries(entries);
  }
  if (
    !object(value) ||
    !text(value.model, 256) ||
    !object(value.answers) ||
    !sameKeys(value.answers, Object.keys(questions)) ||
    !object(value.usage)
  )
    fail();
  const { input_tokens: inputTokens, output_tokens: outputTokens } = value.usage;
  if (
    typeof inputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0
  )
    fail();
  const rawAnswers = value.answers;
  const answers = Object.fromEntries(
    Object.entries(questions).map(([id, question]) => {
      const answer = rawAnswers[id];
      if (!object(answer)) fail();
      if (question.type === "probability") {
        if (answer.type !== "noul") fail();
        return [id, { type: "probability", value: probability(answer.noul) }];
      }
      if (answer.type !== question.type) fail();
      const confidence = probability(answer.confidence);
      if (question.type === "choice") {
        const probabilities = distribution(answer.probabilities, Object.keys(question.options));
        if (typeof answer.choice !== "string" || !Object.hasOwn(question.options, answer.choice))
          fail();
        if (probabilities[answer.choice]! + 0.000001 < Math.max(...Object.values(probabilities)))
          fail();
        return [id, { type: "choice", value: answer.choice, probabilities, confidence }];
      }
      const keys = question.levels.map((_, i) => String(i));
      const probabilities = distribution(answer.probabilities, keys);
      if (
        !object(answer.legend) ||
        !sameKeys(answer.legend, keys) ||
        keys.some(
          (key) =>
            answer.legend &&
            (answer.legend as Record<string, unknown>)[key] !== question.levels[Number(key)],
        )
      )
        fail();
      const expectedScore = keys.reduce((sum, key) => sum + Number(key) * probabilities[key]!, 0);
      // Allow the distribution's 1% rounding tolerance, scaled to the level range.
      const scoreTolerance = 0.01 * (question.levels.length - 1);
      if (
        typeof answer.score !== "number" ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > question.levels.length - 1 ||
        Math.abs(answer.score - expectedScore) > scoreTolerance
      )
        fail();
      return [
        id,
        { type: "score", value: answer.score, probabilities, confidence, levels: answer.legend },
      ];
    }),
  );
  return {
    model: value.model,
    answers,
    usage: { inputTokens, outputTokens },
    durationMs,
  } as DecisionResult<Q>;
}
