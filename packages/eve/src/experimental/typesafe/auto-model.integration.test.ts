import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { DynamicResolveContext } from "#dynamic/definition.js";

import { autoModel } from "./auto-model.js";
import { anthropic } from "#public/models/anthropic/index.js";

import { ContextContainer } from "#context/container.js";
import { deserializeContext, serializeContext } from "#context/serialize.js";

const runtime = vi.hoisted(() => ({ state: undefined as ContextContainer | undefined }));
vi.mock("#context/container.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#context/container.js")>()),
  loadContext: () => runtime.state!,
}));

const options = {
  "openai/large": "Hard reasoning",
  "openai/small": "Routine requests",
} as const;
function context(text = "Alice requests a routine summary."): DynamicResolveContext {
  return {
    model: null,
    channel: {},
    session: { id: "test", auth: { current: null, initiator: null } },
    messages: [{ role: "user", content: text }],
    abortSignal: new AbortController().signal,
  };
}
function event(turnId = "turn_1") {
  return { type: "step.started", data: { turnId } };
}
function result(model = "openai/small", confidence = 0.9, keys = Object.keys(options)) {
  return Response.json({
    model: "jev-test",
    answers: {
      route: {
        type: "choice",
        choice: model,
        confidence,
        probabilities: Object.fromEntries(
          [...keys, "__eve_typesafe_no_fit__"].map((id) => [id, id === model ? 1 : 0]),
        ),
      },
    },
    usage: { input_tokens: 42, output_tokens: 5 },
  });
}

beforeEach(() => {
  runtime.state = new ContextContainer();
});

describe("autoModel", () => {
  it("routes by option key and restores provider instances without serializing them", async () => {
    const provider = anthropic("sonnet-5");
    const choices = {
      ...options,
      my_secret_model: { model: provider, description: "Easy problems" },
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => result("my_secret_model", 0.9, Object.keys(choices)));
    const onDecision = vi.fn();
    const create = (model = provider) =>
      autoModel({
        options: { ...choices, my_secret_model: { model, description: "Easy problems" } },
        apiKey: "test",
        fetch,
        onDecision,
        eligible: (key) => {
          expectTypeOf(key).toEqualTypeOf<"openai/large" | "openai/small" | "my_secret_model">();
          return true;
        },
      }).events["step.started"]!;
    expect(await create()(event(), context())).toBe(provider);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body)).questions.route.criteria).toEqual({
      ...options,
      my_secret_model: "Easy problems",
      __eve_typesafe_no_fit__: "None of the configured models fits this task.",
    });
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ model: "my_secret_model" }));
    const saved = serializeContext(runtime.state!);
    expect(JSON.stringify(saved)).not.toContain("sonnet-5");
    runtime.state = await deserializeContext(saved);
    const restoredProvider = anthropic("sonnet-5");
    expect(await create(restoredProvider)(event(), context())).toBe(restoredProvider);
    expect(fetch).toHaveBeenCalledOnce();
    expect(onDecision).toHaveBeenCalledOnce();
    const changedProvider = anthropic("another-model");
    expect(await create(changedProvider)(event(), context())).toBe(changedProvider);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["uncertainty", "unavailable"])(
    "resolves a provider fallback for %s by option key",
    async (source) => {
      const model = anthropic("sonnet-5");
      const handler = autoModel({
        options: { custom: { model, description: "Easy problems" } },
        apiKey: "test",
        fetch: async () =>
          source === "unavailable"
            ? new Response(null, { status: 529 })
            : result("__eve_typesafe_no_fit__", 0.9, ["custom"]),
        fallback: { model: "custom", onUnavailable: true },
      }).events["step.started"]!;
      expect(await handler(event(), context())).toBe(model);
      runtime.state = await deserializeContext(serializeContext(runtime.state!));
      expect(await handler(event(), context())).toBe(model);
    },
  );

  it("resolves string model aliases and applies eligibility to option keys", async () => {
    const eligible = vi.fn((key: string) => key === "custom");
    const handler = autoModel({
      options: {
        ...options,
        custom: { model: "anthropic/sonnet-5", description: "Easy problems" },
      },
      eligible,
      apiKey: "test",
      fetch: async () => result("custom", 0.9, ["custom"]),
    }).events["step.started"]!;
    expect(await handler(event(), context())).toBe("anthropic/sonnet-5");
    expect(eligible.mock.calls.map(([key]) => key)).toEqual([
      "openai/large",
      "openai/small",
      "custom",
    ]);
  });

  it.each([
    null,
    [],
    { broken: null },
    { broken: 42 },
    { broken: { description: "Missing model" } },
    { broken: { model: {}, description: "Invalid model" } },
    { broken: { model: "", description: "Empty model" } },
    { broken: { model: "openai/large", description: "" } },
  ])("rejects invalid option maps", (options) => {
    expect(() => autoModel({ options } as never)).toThrow();
  });

  it("defers inference, sees the first prompt, reuses the turn, and selects again on the next turn", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => result());
    const onDecision = vi.fn();
    const handler = autoModel({ options, apiKey: "test", fetch, onDecision }).events[
      "step.started"
    ]!;
    expect(fetch).not.toHaveBeenCalled();
    expect(await handler(event(), context())).toBe("openai/small");
    expect(await handler(event(), context())).toBe("openai/small");
    expect(fetch).toHaveBeenCalledOnce();
    expect(onDecision).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![1]!.body).toContain("Alice requests a routine summary.");
    expect(await handler(event("turn_2"), context())).toBe("openai/small");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retains a selection through durable context serialization", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => result());
    const handler = autoModel({ options, apiKey: "test", fetch }).events["step.started"]!;
    await handler(event(), context());
    const saved = serializeContext(runtime.state!);
    expect(Object.keys(saved)).toEqual([
      expect.stringMatching(/^eve\.experimental\.typesafe\.model\./),
    ]);
    runtime.state = await deserializeContext(saved);
    await handler(event(), context());
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retains session scope but never shares a selection with a child session", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => result());
    const handler = autoModel({ options, apiKey: "test", fetch, scope: "session" }).events[
      "step.started"
    ]!;
    await handler(event(), context());
    await handler(event("turn_2"), context());
    expect(fetch).toHaveBeenCalledOnce();
    runtime.state = new ContextContainer();
    await handler(event(), context("Bob has a separate child task."));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses explicit uncertainty fallback and retains the original distribution", async () => {
    const onDecision = vi.fn();
    const handler = autoModel({
      options,
      apiKey: "test",
      fetch: async () => result("openai/small", 0.2),
      fallback: { model: "openai/large", minConfidence: 0.8 },
      onDecision,
    }).events["step.started"]!;
    expect(await handler(event(), context())).toBe("openai/large");
    expect(onDecision.mock.calls[0]![0]).toMatchObject({
      source: "uncertainty",
      answer: { value: "openai/small", confidence: 0.2 },
    });
  });

  it("fails no-fit without fallback, and rejects a fabricated choice", async () => {
    const noFit = autoModel({
      options,
      apiKey: "test",
      fetch: async () => result("__eve_typesafe_no_fit__"),
    });
    await expect(noFit.events["step.started"]!(event(), context())).rejects.toMatchObject({
      code: "routing",
    });
    const fabricated = autoModel({
      options,
      apiKey: "test",
      fetch: async () => result("outside"),
      fallback: { model: "openai/large", onUnavailable: true },
    });
    await expect(fabricated.events["step.started"]!(event(), context())).rejects.toMatchObject({
      code: "response",
    });
  });

  it("falls back once during an outage without swallowing authentication errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response(null, { status: 529 }));
    const config = {
      options,
      apiKey: "test",
      fetch,
      fallback: { model: "openai/large", onUnavailable: true },
    } as const;
    const handler = autoModel(config).events["step.started"]!;
    expect(await handler(event(), context())).toBe("openai/large");
    expect(await handler(event(), context())).toBe("openai/large");
    expect(fetch).toHaveBeenCalledOnce();
    runtime.state = new ContextContainer();
    fetch.mockImplementation(async () => new Response(null, { status: 401 }));
    await expect(handler(event(), context())).rejects.toMatchObject({ code: "authentication" });
  });

  it("propagates turn cancellation even when fallback is configured", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => {}));
    const handler = autoModel({
      options,
      apiKey: "test",
      fetch,
      fallback: { model: "openai/large", onUnavailable: true },
    }).events["step.started"]!;
    const pending = handler(event(), { ...context(), abortSignal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(serializeContext(runtime.state!)).toEqual({});
  });

  it("bounds a custom state callback and uses deadline fallback", async () => {
    const handler = autoModel({
      options,
      apiKey: "test",
      state: () => new Promise(() => {}),
      timeoutMs: 10,
      fallback: { model: "openai/large", onUnavailable: true },
    }).events["step.started"]!;
    expect(await handler(event(), context())).toBe("openai/large");
  });

  it("does not reuse a selected model when deterministic constraints change", async () => {
    let enabled = true;
    const handler = autoModel({
      options,
      apiKey: "test",
      fetch: async () => result(),
      eligible: () => enabled,
    }).events["step.started"]!;
    await handler(event(), context());
    enabled = false;
    await expect(handler(event(), context())).rejects.toMatchObject({ code: "routing" });
  });

  it("requires explicit nontext eligibility and bounds exported text", async () => {
    const handler = autoModel({ options, apiKey: "test", fetch: vi.fn() }).events["step.started"]!;
    await expect(
      handler(event(), {
        ...context(),
        messages: [
          {
            role: "user",
            content: [{ type: "image", image: new URL("https://example.com/image.png") }],
          },
        ],
      }),
    ).rejects.toThrow("Nontext input");
    await expect(handler(event(), context("x".repeat(16_001)))).rejects.toThrow("16000");
  });

  it.each(["turn", "session"] as const)(
    "gives scope-aware recovery when a retained %s model becomes ineligible",
    async (scope) => {
      let smallEnabled = true;
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => result());
      const handler = autoModel({
        options,
        scope,
        apiKey: "test",
        fetch,
        eligible: (model) => model !== "openai/small" || smallEnabled,
      }).events["step.started"]!;
      await handler(event(), context());
      smallEnabled = false;
      await expect(
        handler(event(scope === "session" ? "turn_2" : "turn_1"), context()),
      ).rejects.toMatchObject({
        code: "routing",
        message: `The retained model no longer meets this ${scope}'s requirements. Start a new ${scope} or update the routing policy.`,
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("checks nontext steering before reusing a cached route", async () => {
    const handler = autoModel({ options, apiKey: "test", fetch: async () => result() }).events[
      "step.started"
    ]!;
    await handler(event(), context());
    await expect(
      handler(event(), {
        ...context(),
        messages: [
          {
            role: "user",
            content: [{ type: "image", image: new URL("https://example.com/image.png") }],
          },
        ],
      }),
    ).rejects.toThrow("Nontext input");
  });

  it("rejects asynchronous eligibility instead of treating a Promise as permission", async () => {
    const handler = autoModel({
      options,
      apiKey: "test",
      fetch: async () => result(),
      eligible: (() => Promise.resolve(false)) as never,
    }).events["step.started"]!;
    await expect(handler(event(), context())).rejects.toThrow("boolean synchronously");
  });

  it("rejects ambiguous configuration before compilation", () => {
    expect(() => autoModel({ options: {} })).toThrow();
    expect(() => autoModel({ options: [[42, "Routine work"]] } as never)).toThrow();
    expect(() => autoModel({ options: { __eve_typesafe_no_fit__: "Reserved" } })).toThrow();
    expect(() => autoModel({ options, fallback: { model: "outside" } } as never)).toThrow();
    expect(() =>
      autoModel({ options, fallback: { model: "openai/large", minConfidence: 2 } }),
    ).toThrow();
    expect(() => autoModel({ options, decisionModel: "" })).toThrow();
  });
});
