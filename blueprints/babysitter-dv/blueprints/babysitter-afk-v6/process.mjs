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
  if (!path.isAbsolute(inputs.configModule) || inputs.configModule.includes("\0") || !inputs.configModule.endsWith(".mjs")) {
    throw new TypeError("configModule must be an absolute local .mjs module");
  }
  const configUrl = pathToFileURL(inputs.configModule).href;
  const config = await import(configUrl);
  const resolvePorts = config.createPorts ?? config.default;
  if (typeof resolvePorts !== "function") throw new TypeError("config module must export createPorts(inputs) or default(inputs)");
  const ports = await resolvePorts(inputs.runInput);
  const blueprint = createAfkDeliveryBlueprint(ports);
  // The process deliberately delegates all effects to the blueprint. Calling
  // `ctx.task` here would create an unguarded second effect owner.
  return blueprint.run(inputs.runInput);
}
