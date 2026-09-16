import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamicResolveContext } from "#dynamic/definition.js";

import { autoModel } from "./auto-model.js";

import { ContextContainer } from "#context/container.js";
import { deserializeContext, serializeContext } from "#context/serialize.js";

const runtime = vi.hoisted(() => ({ state: undefined as ContextContainer | undefined }));
vi.mock("#context/container.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#context/container.js")>()),
  loadContext: () => runtime.state!,
}));

const options = [
  ["openai/large", "Hard reasoning"],
  ["openai/small", "Routine requests"],
] as const;
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
function result(model = "openai/small", confidence = 0.9) {
  return Response.json({
    model: "jev-test",
    answers: {
      route: {
        type: "choice",
        choice: model,
        confidence,
        probabilities: Object.fromEntries(
          [...options.map(([id]) => id), "__eve_typesafe_no_fit__"].map((id) => [
            id,
            id === model ? 1 : 0,
          ]),
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
      minConfidence: 0.8,
      fallback: "openai/large",
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
      fallback: "openai/large",
      onError: "fallback",
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
      fallback: "openai/large",
      onError: "fallback",
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
      fallback: "openai/large",
      onError: "fallback",
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
      fallback: "openai/large",
      onError: "fallback",
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
    expect(() => autoModel({ options: [] })).toThrow();
    expect(() => autoModel({ options: [[42, "Routine work"]] } as never)).toThrow();
    expect(() => autoModel({ options: [options[0], options[0]] })).toThrow();
    expect(() => autoModel({ options, minConfidence: 0.8 })).toThrow();
    expect(() => autoModel({ options, fallback: "outside" } as never)).toThrow();
  });
});
