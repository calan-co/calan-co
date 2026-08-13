import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAfkDeliveryBlueprint } from "../../src/afk-delivery-blueprint.js";

/**
 * Babysitter v6 process. JSON inputs select an importable local adapter module;
 * executable ports never cross the JSON boundary.
 */
export async function process(inputs, ctx) {
  if (!inputs || typeof inputs !== "object" || typeof inputs.configModule !== "string" || !inputs.runInput || typeof inputs.runInput !== "object") {
    throw new TypeError("JSON inputs require configModule and runInput objects");
  }
  if (!ctx?.task || typeof ctx.task !== "function") throw new TypeError("Babysitter v6 ctx.task is required");
  if (!path.isAbsolute(inputs.configModule) || inputs.configModule.includes("\0") || !inputs.configModule.endsWith(".mjs")) {
    throw new TypeError("configModule must be an absolute local .mjs module");
  }
  const configUrl = pathToFileURL(inputs.configModule).href;
  const config = await import(configUrl);
  const resolvePorts = config.createPorts ?? config.default;
  if (typeof resolvePorts !== "function") throw new TypeError("config module must export createPorts(inputs) or default(inputs)");
  const ports = await resolvePorts(inputs.runInput);
  const blueprint = createAfkDeliveryBlueprint(ports);
  const { defineTask } = await import("@a5c-ai/babysitter-sdk");
  const deliveryTask = defineTask("babysitter-afk-delivery", () => ({
    kind: "agent", title: "Execute verified Babysitter AFK delivery",
    agent: { name: "general-purpose", prompt: { role: "Babysitter AFK delivery operator", task: "Record and execute the configured delivery run.", context: { runInput: inputs.runInput }, instructions: ["Use only the configured evidence-guarded ports.", "Return the structured outcome."], outputFormat: "JSON" } },
  }));
  await ctx.task(deliveryTask, { runInput: inputs.runInput });
  return blueprint.run(inputs.runInput);
}
