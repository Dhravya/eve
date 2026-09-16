import { afterEach, describe, expect, it, vi } from "vitest";

import { decide } from "./decide.js";
import { decisionTool } from "./tool.js";
import type { ToolContext } from "eve/tools";

vi.mock("eve/tools", () => ({ defineTool: (definition: unknown) => definition }));

const questions = { urgent: { type: "probability", prompt: "Is action urgent?" } } as const;
const payload = {
  model: "jev-test",
  answers: { urgent: { type: "noul", noul: 0.9 } },
  usage: { input_tokens: 20, output_tokens: 2 },
};
const base = { apiKey: "test-key", state: "Alice reports a failed export.", questions };
const ok = () => Response.json(payload);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TypeSafe transport", () => {
  it("sends all questions in one authenticated request and returns usage", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(ok());
    const result = await decide({ ...base, fetch });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      model: "jev-latest",
      state: base.state,
      questions: { urgent: { type: "noul", instructions: questions.urgent.prompt } },
    });
    expect(result.answers.urgent.value).toBe(0.9);
    expect(result.usage.inputTokens).toBe(20);
  });

  it("reads credentials at runtime and never requires them when defining a tool", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(ok());
    const tool = decisionTool({ fetch });
    await expect(decide({ state: "a", questions, fetch })).rejects.toMatchObject({
      code: "authentication",
    });
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("TYPESAFE_API_KEY", "runtime-key");
    const result = await tool.execute({ state: "a", questions }, {
      abortSignal: new AbortController().signal,
    } as ToolContext);
    expect(result).toMatchObject({ model: "jev-test" });
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ authorization: "Bearer runtime-key" });
  });

  it("does not let tool input replace the author-controlled model or transport", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(ok());
    const tool = decisionTool({ apiKey: "authored-key", model: "jev-pinned", fetch });
    await tool.execute(
      { state: "a", questions, model: "injected" } as never,
      { abortSignal: new AbortController().signal } as ToolContext,
    );
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).model).toBe("jev-pinned");
  });

  it.each([408, 429, 500, 529])("retries transient HTTP %s within the deadline", async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response("private upstream details", { status, headers: { "retry-after-ms": "0" } }),
      )
      .mockResolvedValueOnce(ok());
    await expect(decide({ ...base, fetch })).resolves.toMatchObject({ model: "jev-test" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 422])(
    "does not retry HTTP %s or disclose the response body",
    async (status) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response("secret provider debug data", { status }));
      const error = await decide({ ...base, fetch }).catch((error: Error) => error);
      expect(String(error)).not.toContain("secret");
      expect(error).toMatchObject({ status });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("bounds the whole request including credential resolution", async () => {
    await expect(
      decide({ ...base, timeoutMs: 10, apiKey: () => new Promise(() => {}), fetch: vi.fn() }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("bounds retry-after instead of waiting past the total deadline", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "60" } }));
    await expect(decide({ ...base, fetch, timeoutMs: 10 })).rejects.toMatchObject({
      code: "timeout",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("cancels a stalled body read and does not retry", async () => {
    let cancelled = false;
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
    const pending = decide({ ...base, fetch, signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort(new Error("turn cancelled"));
    await expect(pending).rejects.toThrow("turn cancelled");
    expect(cancelled).toBe(true);
  });

  it("rejects oversized and malformed responses without exposing their contents", async () => {
    for (const response of [
      new Response("s".repeat(1_048_577)),
      new Response("not-json-secret"),
      Response.json({ secret: "invalid" }),
    ]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
      await expect(decide({ ...base, fetch })).rejects.toMatchObject({ code: "response" });
      expect(fetch).toHaveBeenCalledOnce();
    }
  });

  it("retries a network failure but strips its internal message", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error("private hostname and token"));
    await expect(decide({ ...base, fetch, maxRetries: 0 })).rejects.toMatchObject({
      code: "unavailable",
      message: "Could not reach TypeSafe. Retry the decision when the service is available.",
    });
  });
});
