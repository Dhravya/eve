import { defineEval } from "eve/evals";

export default defineEval({
  description: "An unavailable Jev service fails routing before any LLM or tool call.",
  async test(t) {
    const turn = await t.send("Alice records the service unavailable incident for review.");
    turn.eventsSatisfy("routing failure is reported", (events) =>
      events.some(
        (event) =>
          event.type === "turn.failed" &&
          event.data.message.includes("TypeSafe is temporarily unavailable"),
      ),
    );
    turn.usedNoTools();
  },
});
