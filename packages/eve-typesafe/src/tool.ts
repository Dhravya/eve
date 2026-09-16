import { defineTool, type ToolDefinition } from "eve/tools";

import { decide } from "./decide.js";
import type { DecisionConfig, DecisionInput, DecisionResult } from "./types.js";
import { validateConfig } from "./validation.js";

const prompt = { type: "string", minLength: 1, maxLength: 8192 };
const description = { type: "string", minLength: 1, maxLength: 4096 };

/** Create a path-named eve tool. The agent supplies evidence and a finite question map. */
export function decisionTool(
  config: DecisionConfig = {},
): ToolDefinition<DecisionInput, DecisionResult> {
  validateConfig(config);
  const options = { ...config };
  return defineTool<DecisionInput, DecisionResult>({
    description:
      "Evaluate narrow, independent decisions using Jev. Supply all relevant evidence in state and batch questions about that same state together. Use choice for finite alternatives, score for ordered levels, and probability for yes/no judgments. Questions cannot see each other's answers. Results include uncertainty, not authorization to act. This tool cannot generate arbitrary text or JSON schemas.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["state", "questions"],
      properties: {
        state: {
          anyOf: [
            { type: "string" },
            { type: "object", additionalProperties: true },
            { type: "array", items: {} },
          ],
        },
        questions: {
          type: "object",
          minProperties: 1,
          maxProperties: 64,
          additionalProperties: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "prompt", "options"],
                properties: {
                  type: { const: "choice" },
                  prompt,
                  options: {
                    type: "object",
                    minProperties: 1,
                    maxProperties: 255,
                    additionalProperties: description,
                  },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "prompt", "levels"],
                properties: {
                  type: { const: "score" },
                  prompt,
                  levels: { type: "array", minItems: 2, maxItems: 10, items: description },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "prompt"],
                properties: { type: { const: "probability" }, prompt },
              },
            ],
          },
        },
      },
    },
    execute(input, ctx) {
      return decide({
        state: input.state,
        questions: input.questions,
        ...options,
        signal: ctx.abortSignal,
      });
    },
  });
}
