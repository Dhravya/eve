import { defineEval } from "eve/evals";

export default defineEval({
  description: "Jev routes each turn once and the generic decision tool returns typed answers.",
  async test(t) {
    const first = await t.send("Alice needs a routine summary of the incident evidence.");
    first.expectOk();
    first.messageIncludes('"model":"openai/small"');
    first.messageIncludes('"requests":1');
    first.messageIncludes('"value":0.95');
    first.eventsSatisfy(
      "tool continuation retains the selected model",
      (events) => events.filter((event) => event.type === "step.started").length >= 2,
    );
    const second = await t.send("Bob now needs a difficult investigation of that incident.");
    second.expectOk();
    second.messageIncludes('"model":"openai/large"');
    second.messageIncludes('"requests":2');
    t.succeeded();
  },
});
