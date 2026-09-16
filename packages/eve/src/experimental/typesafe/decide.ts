import { setTimeout as delay } from "node:timers/promises";

import { DecisionError } from "./errors.js";
import type { DecisionQuestions, DecisionRequest, DecisionResult } from "./types.js";
import {
  boundedJson,
  MAX_RESPONSE_BYTES,
  parseResult,
  validateConfig,
  validateInput,
  wireQuestions,
} from "./validation.js";

export async function withSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new DecisionError("response", "TypeSafe returned an empty response.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await withSignal(reader.read(), signal);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES)
        throw new DecisionError("response", "TypeSafe response exceeds the 1 MiB limit.");
      chunks.push(next.value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (cause) {
    throw new DecisionError("response", "TypeSafe returned invalid JSON.", { cause });
  }
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const header = response?.headers.get("retry-after");
  const msHeader = response?.headers.get("retry-after-ms");
  const ms = msHeader === null || msHeader === undefined ? NaN : Number(msHeader);
  const seconds = header === null || header === undefined ? NaN : Number(header);
  const requested = Number.isFinite(ms)
    ? ms
    : Number.isFinite(seconds)
      ? seconds * 1000
      : header
        ? Date.parse(header) - Date.now()
        : NaN;
  return Number.isFinite(requested) && requested >= 0
    ? Math.min(requested, 60_000)
    : 100 * 2 ** attempt;
}

/** Evaluate up to 64 independent questions over shared evidence in one Jev request. */
export async function decide<const Q extends DecisionQuestions>(
  request: DecisionRequest<Q>,
): Promise<DecisionResult<Q>> {
  validateConfig(request);
  validateInput(request);
  request.signal?.throwIfAborted();
  const started = performance.now();
  const deadline = new AbortController();
  const timer = setTimeout(
    () =>
      deadline.abort(
        new DecisionError("timeout", "TypeSafe decision exceeded its total deadline."),
      ),
    request.timeoutMs ?? 5000,
  );
  const signal = request.signal
    ? AbortSignal.any([request.signal, deadline.signal])
    : deadline.signal;
  try {
    let key: string | undefined;
    try {
      key =
        typeof request.apiKey === "function"
          ? await withSignal(Promise.resolve().then(request.apiKey), signal)
          : (request.apiKey ?? process.env.TYPESAFE_API_KEY);
    } catch (cause) {
      signal.throwIfAborted();
      throw new DecisionError("authentication", "Could not resolve the TypeSafe API key.", {
        cause,
      });
    }
    if (typeof key !== "string" || key.trim().length === 0)
      throw new DecisionError(
        "authentication",
        "Set TYPESAFE_API_KEY or provide apiKey at runtime to use Jev decisions.",
      );
    const body = boundedJson({
      model: request.model ?? "jev-latest",
      state: request.state,
      questions: wireQuestions(request.questions),
    });
    const transport = request.fetch ?? globalThis.fetch;
    const retries = request.maxRetries ?? 1;
    for (let attempt = 0; attempt <= retries; attempt++) {
      signal.throwIfAborted();
      let response: Response | undefined;
      try {
        response = await withSignal<Response>(
          Promise.resolve().then(() =>
            transport("https://api.typesafe.ai/v1/systemone", {
              method: "POST",
              headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
              body,
              signal,
              redirect: "error",
            }),
          ),
          signal,
        );
        if (response.ok) {
          const payload = await readResponse(response, signal);
          signal.throwIfAborted();
          return parseResult(payload, request.questions, performance.now() - started);
        }
      } catch (cause) {
        signal.throwIfAborted();
        if (cause instanceof DecisionError) throw cause;
        if (attempt === retries)
          throw new DecisionError(
            "unavailable",
            "Could not reach TypeSafe. Retry the decision when the service is available.",
            { cause },
          );
      }
      if (response) {
        void response.body?.cancel().catch(() => undefined);
        const status = response.status;
        if (status === 401 || status === 403)
          throw new DecisionError(
            "authentication",
            "TypeSafe rejected the API key. Check its access in the TypeSafe console.",
            { status },
          );
        const retryable = status === 408 || status === 429 || status >= 500;
        if (!retryable)
          throw new DecisionError(
            "request",
            "TypeSafe rejected the decision request. Check its model and question limits.",
            { status },
          );
        if (attempt === retries)
          throw new DecisionError(
            "unavailable",
            "TypeSafe is temporarily unavailable or rate limited. Retry later.",
            { status },
          );
      }
      await delay(retryDelay(response, attempt), undefined, { signal });
    }
    throw new DecisionError("unavailable", "TypeSafe decision did not complete.");
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
