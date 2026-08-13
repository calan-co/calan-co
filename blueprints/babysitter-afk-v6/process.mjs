/**
 * Babysitter v6-facing process entry point. The SDK is resolved from the
 * installed blueprint package, so importing this descriptor remains portable.
 */
export async function process(inputs, ctx) {
  if (!inputs || typeof inputs.run !== "function") throw new TypeError("inputs.run must be a blueprint runner");
  if (!ctx?.task || typeof ctx.task !== "function") throw new TypeError("Babysitter v6 ctx.task is required");
  const { defineTask } = await import("@a5c-ai/babysitter-sdk");
  const deliveryTask = defineTask("babysitter-afk-delivery", () => ({
    kind: "agent",
    title: "Execute verified Babysitter AFK delivery",
    agent: {
      name: "general-purpose",
      prompt: {
        role: "Babysitter AFK delivery operator",
        task: "Execute the injected, evidence-guarded delivery runner and return its structured outcome.",
        context: { runInput: inputs.runInput },
        instructions: ["Use the configured runner only after its override and evidence gates pass.", "Return the structured delivery outcome."],
        outputFormat: "JSON",
      },
    },
  }));
  // The durable task records the process boundary; the injected runner owns
  // repository effects and returns the same structured delivery outcome.
  await ctx.task(deliveryTask, { runInput: inputs.runInput });
  return inputs.run(inputs.runInput);
}
