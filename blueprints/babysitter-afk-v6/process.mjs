/**
 * Babysitter v6-facing process entry point. `ctx.task` remains the durable
 * effect boundary; callers inject the portable composition root as `inputs.run`.
 */
export async function process(inputs, ctx) {
  if (!inputs || typeof inputs.run !== "function") throw new TypeError("inputs.run must be a blueprint runner");
  if (!ctx?.task || typeof ctx.task !== "function") throw new TypeError("Babysitter v6 ctx.task is required");
  return ctx.task("babysitter-afk-delivery", async () => inputs.run(inputs.runInput));
}
