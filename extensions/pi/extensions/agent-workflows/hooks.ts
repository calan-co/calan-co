export const HOOK_PHASES = Object.freeze(["beforeNode", "afterNode", "onNodeError"] as const);
export const HOOK_TOPOLOGIES = Object.freeze(["node", "subtree"] as const);
export const WELL_KNOWN_HOOK_CONTEXT_NAMESPACES = Object.freeze(["global", "runtime", "node", "role"] as const);

export type HookPhase = typeof HOOK_PHASES[number];
export type HookTopology = typeof HOOK_TOPOLOGIES[number];

export interface HookContext {
	global: Record<string, unknown>;
	runtime: Record<string, unknown>;
	node: Record<string, unknown>;
	role?: Record<string, unknown>;
	[providerNamespace: string]: Record<string, unknown> | undefined;
}

export interface GraphNodeHook {
	id: string;
	phase: HookPhase;
	topology?: HookTopology;
	order?: number;
	capabilities?: string[];
	run(context: HookContext): unknown | Promise<unknown>;
}

export type NodeHook = GraphNodeHook;

const WELL_KNOWN_NAMESPACE_SET = new Set<string>(WELL_KNOWN_HOOK_CONTEXT_NAMESPACES);
const PHASE_SET = new Set<string>(HOOK_PHASES);
const TOPOLOGY_RANK: Record<HookTopology, number> = Object.freeze({ node: 0, subtree: 1 });

function stableStrings(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	return values.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

export function validateProviderNamespaces(providers: Record<string, unknown> | undefined): void {
	if (!providers) return;
	for (const key of Object.keys(providers)) {
		if (WELL_KNOWN_NAMESPACE_SET.has(key)) throw new Error(`Hook provider namespace '${key}' cannot overwrite a well-known namespace`);
	}
}

export function buildHookContext(input: {
	global?: Record<string, unknown>;
	runtime?: Record<string, unknown>;
	node: Record<string, unknown>;
	role?: Record<string, unknown>;
	providers?: Record<string, unknown>;
}): HookContext {
	validateProviderNamespaces(input.providers);
	const context: HookContext = {
		global: { ...(input.global || {}) },
		runtime: { ...(input.runtime || {}) },
		node: { ...input.node },
		...(input.role ? { role: { ...input.role } } : {}),
	};
	for (const [namespace, value] of Object.entries(input.providers || {})) {
		context[namespace] = isRecord(value) ? value : { value };
	}
	return context;
}

export function discoverHooksByCapability(hooks: readonly GraphNodeHook[] | undefined, capabilities: readonly string[] | undefined): GraphNodeHook[] {
	if (!hooks?.length) return [];
	const capabilitySet = new Set(stableStrings([...(capabilities || [])]));
	return hooks.filter((hook) => {
		const hookCapabilities = stableStrings(hook.capabilities);
		if (!hookCapabilities.length) return true;
		return hookCapabilities.some((capability) => capabilitySet.has(capability));
	});
}

export function sortHooksForPhase(hooks: readonly GraphNodeHook[] | undefined, phase: HookPhase): GraphNodeHook[] {
	if (!PHASE_SET.has(phase)) throw new Error(`Unknown hook phase '${phase}'`);
	return (hooks || [])
		.map((hook, registrationOrder) => ({ hook, registrationOrder }))
		.filter(({ hook }) => hook.phase === phase)
		.sort((left, right) => {
			const leftTopology = TOPOLOGY_RANK[left.hook.topology || "node"] ?? Number.MAX_SAFE_INTEGER;
			const rightTopology = TOPOLOGY_RANK[right.hook.topology || "node"] ?? Number.MAX_SAFE_INTEGER;
			if (leftTopology !== rightTopology) return leftTopology - rightTopology;
			const leftOrder = Number.isFinite(left.hook.order) ? Number(left.hook.order) : 0;
			const rightOrder = Number.isFinite(right.hook.order) ? Number(right.hook.order) : 0;
			if (leftOrder !== rightOrder) return leftOrder - rightOrder;
			if (left.registrationOrder !== right.registrationOrder) return left.registrationOrder - right.registrationOrder;
			return left.hook.id.localeCompare(right.hook.id);
		})
		.map(({ hook }) => hook);
}

export async function runHooksForPhase(hooks: readonly GraphNodeHook[] | undefined, phase: HookPhase, context: HookContext): Promise<void> {
	for (const hook of sortHooksForPhase(hooks, phase)) await hook.run(context);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
