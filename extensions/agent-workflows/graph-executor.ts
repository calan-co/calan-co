import {
	buildHookContext,
	discoverHooksByCapability,
	runHooksForPhase,
	validateProviderNamespaces,
	type GraphNodeHook,
	type HookContext,
} from "./hooks.ts";

export type { GraphNodeHook, HookContext } from "./hooks.ts";

export type GraphNodeMode = "sequential" | "parallel";
export type NodeExecutionStatus = "succeeded";

export interface GraphWorkflowNode {
	kind: string;
	needs?: string | string[];
	nodes?: Record<string, GraphWorkflowNode>;
	node?: GraphWorkflowNode;
	mode?: GraphNodeMode;
	each?: unknown;
	max?: number;
	with?: Record<string, unknown>;
	capabilities?: string[];
	[key: string]: unknown;
}

export interface BaseNodeResult {
	type: string;
	status: NodeExecutionStatus;
	nodeId: string;
	kind: string;
	output?: unknown;
}

export interface AgentResult extends BaseNodeResult {
	type: "AgentResult";
}

export interface ScriptResult extends BaseNodeResult {
	type: "ScriptResult";
}

export interface ContainerResult extends BaseNodeResult {
	type: "ContainerResult";
	effects: string[];
}

export interface CompositeResult extends BaseNodeResult {
	type: "CompositeResult";
	children: Record<string, NodeResult>;
	order: string[];
}

export interface WorkspaceResult extends BaseNodeResult {
	type: "WorkspaceResult";
	mergeable: true;
	children: Record<string, NodeResult>;
	order: string[];
	effects: string[];
	commits?: string[];
}

export interface LoopResult extends BaseNodeResult {
	type: "LoopResult";
	mode: GraphNodeMode;
	iterations: NodeResult[];
	mergeable?: true;
	mergeableResults: MergeableNodeResult[];
}

export interface GitMergeResult extends BaseNodeResult {
	type: "GitMergeResult";
	merged: string[];
	inputs: Record<string, MergeableNodeResult>;
	effects: string[];
	branch?: string;
	commits?: string[];
	mergedBranches?: string[];
	mergedCommits?: string[];
}

export type MergeableNodeResult = WorkspaceResult | LoopResult;
export type NodeResult = AgentResult | ScriptResult | ContainerResult | CompositeResult | WorkspaceResult | LoopResult | GitMergeResult | BaseNodeResult;

export interface LoopExecutionContext {
	index: number;
	item?: unknown;
}

export interface GraphChildExecutionOptions {
	input?: unknown;
	handlers?: Record<string, GraphNodeHandler>;
	workspace?: Record<string, unknown>;
}

export interface GraphNodeMapExecutionResult {
	children: Record<string, NodeResult>;
	order: string[];
}

export interface GraphNodeExecutionContext {
	id: string;
	path: string;
	node: GraphWorkflowNode;
	input: unknown;
	needs: Record<string, NodeResult>;
	loop?: LoopExecutionContext;
	workspace?: Record<string, unknown>;
	children?: Record<string, NodeResult>;
	executeChildren?: (options?: GraphChildExecutionOptions) => Promise<GraphNodeMapExecutionResult>;
}

export type GraphNodeHandler = (context: GraphNodeExecutionContext) => unknown | Promise<unknown>;

export interface GraphHookContextSeed {
	global?: Record<string, unknown>;
	runtime?: Record<string, unknown>;
	providers?: Record<string, unknown>;
}

export interface GraphExecutorOptions {
	input?: unknown;
	handlers?: Record<string, GraphNodeHandler>;
	hooks?: GraphNodeHook[];
	hookCapabilities?: string[];
	hookContext?: GraphHookContextSeed;
}

interface ExecutionScope {
	input: unknown;
	handlers: Record<string, GraphNodeHandler>;
	hooks: GraphNodeHook[];
	hookCapabilities: string[];
	hookContext: GraphHookContextSeed;
	loop?: LoopExecutionContext;
	workspace?: Record<string, unknown>;
}

const LEAF_RESULT_TYPES: Record<string, string> = Object.freeze({
	agent: "AgentResult",
	"agent.pi": "AgentResult",
	script: "ScriptResult",
	"docker.container": "ContainerResult",
	"podman.container": "ContainerResult",
});

export async function executeGraphWorkflow(workflow: GraphWorkflowNode, options: GraphExecutorOptions = {}): Promise<CompositeResult> {
	if (!isRecord(workflow)) throw new Error("root must be an object");
	if (workflow.kind !== "composite") throw new Error("root kind must be 'composite'");
	validateProviderNamespaces(options.hookContext?.providers);
	const result = await executeNode("root", "root", workflow, {
		input: options.input,
		handlers: options.handlers || {},
		hooks: options.hooks || [],
		hookCapabilities: stringArray(options.hookCapabilities),
		hookContext: options.hookContext || {},
	}, {});
	return result as CompositeResult;
}

async function executeNode(
	id: string,
	path: string,
	node: GraphWorkflowNode,
	scope: ExecutionScope,
	needs: Record<string, NodeResult>,
): Promise<NodeResult> {
	if (!isRecord(node)) throw new Error(`${path} must be an object`);
	if (typeof node.kind !== "string" || !node.kind) throw new Error(`${path} is missing kind`);
	if (node.max !== undefined && (!Number.isInteger(node.max) || node.max < 1)) throw new Error(`${path} max must be a positive integer`);
	if (!isExecutableNodeKind(node.kind, scope)) throw new Error(`${path} references unknown concrete kind '${node.kind}'`);

	const hooks = discoverHooksByCapability(scope.hooks, nodeHookCapabilities(node, scope));
	const hookContext = makeHookContext(id, path, node, scope, needs);
	await runHooksForPhase(hooks, "beforeNode", hookContext);
	try {
		const result = await executeNodeBody(id, path, node, scope, needs);
		hookContext.runtime.result = result;
		await runHooksForPhase(hooks, "afterNode", hookContext);
		return result;
	} catch (error) {
		hookContext.runtime.error = error;
		try {
			await runHooksForPhase(hooks, "onNodeError", hookContext);
		} catch {
			// Preserve the original node execution error even if an error hook fails.
		}
		throw error;
	}
}

async function executeNodeBody(
	id: string,
	path: string,
	node: GraphWorkflowNode,
	scope: ExecutionScope,
	needs: Record<string, NodeResult>,
): Promise<NodeResult> {
	if (node.kind === "composite") return executeCompositeNode(id, path, node, scope);
	if (node.kind === "loop") return executeLoopNode(id, path, node, scope);
	if (node.kind === "git.worktree") return executeWorkspaceNode(id, path, node, scope, needs);
	if (node.kind === "git.merge") return executeMergeNode(id, path, node, scope, needs);
	if (LEAF_RESULT_TYPES[node.kind]) return executeLeafNode(id, path, node, scope, needs, LEAF_RESULT_TYPES[node.kind]);
	if (scope.handlers[node.kind]) return coerceResult(await scope.handlers[node.kind](makeHandlerContext(id, path, node, scope, needs)), "NodeResult", id, node.kind);
	throw new Error(`${path} references unknown concrete kind '${node.kind}'`);
}

function isExecutableNodeKind(kind: string, scope: ExecutionScope): boolean {
	return kind === "composite"
		|| kind === "loop"
		|| kind === "git.worktree"
		|| kind === "git.merge"
		|| Boolean(LEAF_RESULT_TYPES[kind])
		|| Boolean(scope.handlers[kind]);
}

async function executeCompositeNode(id: string, path: string, node: GraphWorkflowNode, scope: ExecutionScope): Promise<CompositeResult> {
	const { children, order } = await executeNodeMap(node.nodes, `${path}.nodes`, scope);
	return {
		type: "CompositeResult",
		status: "succeeded",
		nodeId: id,
		kind: node.kind,
		children,
		order,
	};
}

async function executeWorkspaceNode(
	id: string,
	path: string,
	node: GraphWorkflowNode,
	scope: ExecutionScope,
	needs: Record<string, NodeResult>,
): Promise<WorkspaceResult> {
	let childRun: GraphNodeMapExecutionResult | undefined;
	const executeChildren = async (options: GraphChildExecutionOptions = {}): Promise<GraphNodeMapExecutionResult> => {
		if (childRun) throw new Error(`${path} children already executed`);
		childRun = await executeNodeMap(node.nodes, `${path}.nodes`, {
			...scope,
			input: options.input === undefined ? scope.input : options.input,
			handlers: options.handlers || scope.handlers,
			workspace: options.workspace === undefined ? scope.workspace : options.workspace,
		});
		return childRun;
	};
	const handlerOutput = scope.handlers["git.worktree"]
		? await scope.handlers["git.worktree"](makeHandlerContext(id, path, node, scope, needs, undefined, executeChildren))
		: undefined;
	if (!childRun) childRun = await executeChildren();
	const base = coerceResult(handlerOutput, "WorkspaceResult", id, node.kind) as Partial<WorkspaceResult>;
	return {
		type: "WorkspaceResult",
		status: "succeeded",
		nodeId: id,
		kind: node.kind,
		children: childRun.children,
		order: childRun.order,
		mergeable: true,
		effects: [],
		...base,
		children: base.children || childRun.children,
		order: base.order || childRun.order,
		mergeable: true,
		effects: Array.isArray(base.effects) ? base.effects : [],
	};
}

async function executeMergeNode(
	id: string,
	path: string,
	node: GraphWorkflowNode,
	scope: ExecutionScope,
	needs: Record<string, NodeResult>,
): Promise<GitMergeResult> {
	const inputs: Record<string, MergeableNodeResult> = {};
	const needed = normalizeNeeds(node.needs, path);
	const inputNames = Array.isArray((node as any).inputs) ? normalizeNeeds((node as any).inputs, path) : needed;
	if (inputNames.length === 0) throw new Error(`${path} requires mergeable needs`);
	for (const need of inputNames) {
		const result = needs[need];
		if (!isMergeableResult(result)) throw new Error(`${path} requires mergeable needs; '${need}' produced ${result?.type || "no result"}`);
		if (!hasMergeEffects(result)) throw new Error(`${path} requires effectful mergeable needs; '${need}' produced no effects or commits`);
		inputs[need] = result;
	}
	const handlerOutput = scope.handlers["git.merge"]
		? await scope.handlers["git.merge"](makeHandlerContext(id, path, node, scope, needs))
		: undefined;
	const base = coerceResult(handlerOutput, "GitMergeResult", id, node.kind) as Partial<GitMergeResult>;
	return {
		type: "GitMergeResult",
		status: "succeeded",
		nodeId: id,
		kind: node.kind,
		merged: inputNames,
		inputs,
		effects: [],
		...base,
		inputs: base.inputs || inputs,
		merged: Array.isArray(base.merged) ? base.merged : inputNames,
		effects: Array.isArray(base.effects) ? base.effects : [],
	};
}

async function executeLeafNode(
	id: string,
	path: string,
	node: GraphWorkflowNode,
	scope: ExecutionScope,
	needs: Record<string, NodeResult>,
	resultType: string,
): Promise<NodeResult> {
	const handler = scope.handlers[node.kind] || (node.kind === "agent.pi" ? scope.handlers.agent : undefined);
	const output = handler ? await handler(makeHandlerContext(id, path, node, scope, needs)) : undefined;
	const result = coerceResult(output, resultType, id, node.kind);
	if (resultType === "ContainerResult") return { effects: [], ...result, effects: Array.isArray((result as ContainerResult).effects) ? (result as ContainerResult).effects : [] };
	return result;
}

async function executeLoopNode(id: string, path: string, node: GraphWorkflowNode, scope: ExecutionScope): Promise<LoopResult> {
	const mode = node.mode || "sequential";
	if (mode !== "sequential" && mode !== "parallel") throw new Error(`${path} mode must be 'sequential' or 'parallel'`);
	const iterations = resolveLoopIterations(path, node, scope.input, scope.loop);
	const hasNode = Object.prototype.hasOwnProperty.call(node, "node");
	const hasNodes = Object.prototype.hasOwnProperty.call(node, "nodes");
	if (hasNode && hasNodes) throw new Error(`${path} loop must define exactly one of node or nodes`);
	if (!hasNode && !hasNodes) throw new Error(`${path} loop must define node or nodes`);

	const runIteration = async (iteration: LoopExecutionContext): Promise<NodeResult> => {
		const iterationScope = { ...scope, loop: iteration };
		if (hasNode) return executeNode(`${id}[${iteration.index}]`, `${path}.node`, node.node as GraphWorkflowNode, iterationScope, {});
		const { children, order } = await executeNodeMap(node.nodes, `${path}.nodes`, iterationScope);
		return {
			type: "CompositeResult",
			status: "succeeded",
			nodeId: `${id}[${iteration.index}]`,
			kind: "composite",
			children,
			order,
		};
	};

	const results = mode === "parallel"
		? await runParallel(iterations, node.max || iterations.length || 1, runIteration)
		: await runSequential(iterations, runIteration);
	const mergeableResults = results.flatMap((result) => collectMergeableResults(result));
	return {
		type: "LoopResult",
		status: "succeeded",
		nodeId: id,
		kind: node.kind,
		mode,
		iterations: results,
		mergeableResults,
		...(mergeableResults.length ? { mergeable: true as const } : {}),
	};
}

async function executeNodeMap(nodes: unknown, path: string, scope: ExecutionScope): Promise<GraphNodeMapExecutionResult> {
	if (!isRecord(nodes)) throw new Error(`${path} must be a map keyed by node id`);
	const entries = Object.entries(nodes as Record<string, GraphWorkflowNode>);
	if (entries.length === 0) throw new Error(`${path} must define at least one child node`);
	const siblingIds = new Set(entries.map(([id]) => id));
	for (const [id, node] of entries) {
		for (const need of normalizeNeeds(node.needs, `${path}.${id}`)) {
			if (!siblingIds.has(need)) throw new Error(`${path}.${id} needs unknown sibling '${need}'`);
		}
	}

	const pending = new Map(entries);
	const children: Record<string, NodeResult> = {};
	const order: string[] = [];
	while (pending.size > 0) {
		let progressed = false;
		for (const [id, node] of entries) {
			if (!pending.has(id)) continue;
			const needs = normalizeNeeds(node.needs, `${path}.${id}`);
			if (!needs.every((need) => Object.prototype.hasOwnProperty.call(children, need))) continue;
			const dependencyResults = Object.fromEntries(needs.map((need) => [need, children[need]]));
			children[id] = await executeNode(id, `${path}.${id}`, node, scope, dependencyResults);
			order.push(id);
			pending.delete(id);
			progressed = true;
		}
		if (!progressed) throw new Error(`${path.replace(/\.nodes$/, "")} dependency cycle or unsatisfied needs among: ${Array.from(pending.keys()).join(", ")}`);
	}
	return { children, order };
}

function resolveLoopIterations(path: string, node: GraphWorkflowNode, input: unknown, parentLoop?: LoopExecutionContext): LoopExecutionContext[] {
	if (node.each === undefined) {
		if (node.mode === "parallel") throw new Error(`${path} parallel loop requires each`);
		const count = node.max || 1;
		return Array.from({ length: count }, (_, index) => ({ index }));
	}
	const items = resolveEachItems(path, node.each, input, parentLoop);
	const selected = node.mode === "parallel" || node.max === undefined ? items : items.slice(0, node.max);
	return selected.map((item, index) => ({ index, item }));
}

function resolveEachItems(path: string, each: unknown, input: unknown, parentLoop?: LoopExecutionContext): unknown[] {
	if (Array.isArray(each)) return each;
	if (typeof each === "function") {
		const value = each({ input, loop: parentLoop });
		if (Array.isArray(value)) return value;
	}
	if (typeof each === "string") {
		const value = resolvePath(input, each);
		if (Array.isArray(value)) return value;
	}
	throw new Error(`${path} each must resolve to an array`);
}

function resolvePath(input: unknown, expression: string): unknown {
	const normalized = expression.trim().replace(/^\$\{(.+)\}$/, "$1").replace(/^\$\.?/, "");
	if (!normalized) return input;
	return normalized.split(".").filter(Boolean).reduce((current: unknown, segment) => {
		if (isRecord(current)) return current[segment];
		return undefined;
	}, input);
}

async function runSequential<T, R>(items: T[], task: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	for (const item of items) results.push(await task(item));
	return results;
}

async function runParallel<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
	const limit = Math.max(1, concurrency);
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	let firstError: unknown;
	const workerCount = Math.min(limit, items.length);
	await Promise.all(Array.from({ length: workerCount }, async () => {
		while (nextIndex < items.length && !firstError) {
			const index = nextIndex;
			nextIndex += 1;
			try {
				results[index] = await task(items[index]);
			} catch (error) {
				if (!firstError) firstError = error;
			}
		}
	}));
	if (firstError) throw firstError;
	return results;
}

function nodeHookCapabilities(node: GraphWorkflowNode, scope: ExecutionScope): string[] {
	return [...new Set([
		...scope.hookCapabilities,
		node.kind,
		`node.kind:${node.kind}`,
		...stringArray(node.capabilities),
	])];
}

function makeHookContext(
	id: string,
	path: string,
	node: GraphWorkflowNode,
	scope: ExecutionScope,
	needs: Record<string, NodeResult>,
): HookContext {
	const roleId = typeof node.role === "string" && node.role.length
		? node.role
		: typeof node.with?.role === "string" && node.with.role.length
			? node.with.role
			: undefined;
	return buildHookContext({
		global: {
			input: scope.input,
			...(scope.hookContext.global || {}),
		},
		runtime: {
			needs,
			...(scope.loop ? { loop: scope.loop } : {}),
			...(scope.workspace ? { workspace: scope.workspace } : {}),
			...(scope.hookContext.runtime || {}),
		},
		node: {
			id,
			path,
			kind: node.kind,
			definition: node,
			needs,
			...(scope.loop ? { loop: scope.loop } : {}),
			...(scope.workspace ? { workspace: scope.workspace } : {}),
		},
		...(roleId ? { role: { id: roleId } } : {}),
		providers: scope.hookContext.providers,
	});
}

function makeHandlerContext(
	id: string,
	path: string,
	node: GraphWorkflowNode,
	scope: ExecutionScope,
	needs: Record<string, NodeResult>,
	children?: Record<string, NodeResult>,
	executeChildren?: (options?: GraphChildExecutionOptions) => Promise<GraphNodeMapExecutionResult>,
): GraphNodeExecutionContext {
	return {
		id,
		path,
		node,
		input: scope.input,
		needs,
		...(scope.loop ? { loop: scope.loop } : {}),
		...(scope.workspace ? { workspace: scope.workspace } : {}),
		...(children ? { children } : {}),
		...(executeChildren ? { executeChildren } : {}),
	};
}

function coerceResult(value: unknown, type: string, nodeId: string, kind: string): NodeResult {
	if (isRecord(value)) {
		const { type: _type, status: _status, nodeId: _nodeId, kind: _kind, ...data } = value;
		return {
			...data,
			type,
			status: "succeeded",
			nodeId,
			kind,
		} as NodeResult;
	}
	return {
		type,
		status: "succeeded",
		nodeId,
		kind,
		...(value !== undefined ? { output: value } : {}),
	};
}

function normalizeNeeds(value: unknown, path: string): string[] {
	if (value === undefined) return [];
	if (typeof value === "string") return [value];
	if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return [...value];
	throw new Error(`${path} needs must be a string or array of strings`);
}

function collectMergeableResults(result: NodeResult): MergeableNodeResult[] {
	if (isMergeableResult(result)) return [result];
	if (result.type === "CompositeResult") return Object.values((result as CompositeResult).children).flatMap((child) => collectMergeableResults(child));
	return [];
}

function isMergeableResult(result: NodeResult | undefined): result is MergeableNodeResult {
	if (!result || (result as { mergeable?: unknown }).mergeable !== true) return false;
	if (result.type === "WorkspaceResult") return true;
	if (result.type === "LoopResult") return Array.isArray((result as LoopResult).mergeableResults) && (result as LoopResult).mergeableResults.every((entry) => entry.type === "WorkspaceResult");
	return false;
}

function hasMergeEffects(result: MergeableNodeResult): boolean {
	if (result.type === "LoopResult") return result.mergeableResults.some((entry) => hasMergeEffects(entry));
	return hasRepositoryEffects((result as WorkspaceResult).effects) || hasNonEmptyStringArray((result as WorkspaceResult).commits);
}

function hasRepositoryEffects(value: unknown): value is string[] {
	return Array.isArray(value) && value.some((entry) => typeof entry === "string" && entry.length > 0 && !isLogArtifactEffect(entry));
}

function hasNonEmptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.some((entry) => typeof entry === "string" && entry.length > 0);
}

function isLogArtifactEffect(value: string): boolean {
	return /^(log|logs|logPath|logFilePath)(:|=|$)/i.test(value.trim());
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
