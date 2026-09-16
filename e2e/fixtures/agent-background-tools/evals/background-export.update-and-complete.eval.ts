import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

const RESULT = "EXPORT-COMPLETE";

export default defineEval({
  description:
    "A background workflow streams progress and delivers one terminal report to the parent.",
  async test(t) {
    const started = await t.send("BACKGROUND-EXPORT-START");
    started.expectOk();
    started.calledTool("export");

    const receipt = started.requireToolCall("export");
    const taskId = readTaskId(receipt.output);
    if (taskId === undefined) throw new Error("export receipt is missing taskId.");

    const sessionId = t.sessionId;
    if (sessionId === undefined) throw new Error("Eval has no parent session id.");

    const doneLive = t.target.watchTurn(sessionId, {
      startIndex: requireStreamIndex(t, "completion wait"),
    });
    const doneTurn = await doneLive.result();
    doneTurn.expectOk();
    doneTurn.messageIncludes("BACKGROUND-EXPORT-DONE");
    await t.require(
      doneTurn.events,
      satisfies(
        (events: typeof doneTurn.events) =>
          events.some(
            (event) =>
              event.type === "message.received" &&
              messageText(event.data.message).includes(
                `Background task ${taskId} (export) is completed.`,
              ) &&
              messageText(event.data.message).includes(RESULT),
          ),
        "parent receives the executor completion with task identity",
      ),
    );
    doneTurn.event("turn.started", { count: 1 });
    doneTurn.notEvent("message.received", {
      data: (data) => messageText(data.message).includes("PROGRESS"),
    });
    t.noFailedActions();
  },
});

function readTaskId(output: unknown): string | undefined {
  if (output === null || typeof output !== "object") return undefined;
  const taskId = Reflect.get(output, "taskId");
  return typeof taskId === "string" ? taskId : undefined;
}

function requireStreamIndex(
  session: { readonly state?: { readonly streamIndex?: number } },
  operation: string,
): number {
  const streamIndex = session.state?.streamIndex;
  if (streamIndex === undefined) throw new Error(`${operation} has no session stream index.`);
  return streamIndex;
}

function messageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (!Array.isArray(message)) return "";
  return message
    .flatMap((part) =>
      part !== null &&
      typeof part === "object" &&
      Reflect.get(part, "type") === "text" &&
      typeof Reflect.get(part, "text") === "string"
        ? [Reflect.get(part, "text") as string]
        : [],
    )
    .join("\n");
}
