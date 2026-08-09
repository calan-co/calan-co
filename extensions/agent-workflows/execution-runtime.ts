import { readFileSync } from "node:fs";
import { parse as parseCel } from "@bufbuild/cel";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUNTIME_PACK_PATH = join(here, "runtime-packs", "sandcastle-templates.json");

export interface ExecutionRuntimePack {
	runtimeVersion: number;
	metadata?: { id?: string; label?: string; description?: string; inspiredBy?: string[] };
	defaults?: Record<string, unknown>;
	providers?: Record<string, unknown>;
	workSources?: Record<string, unknown>;
	issueTrackers?: Record<string, unknown>;
	roles: Record<string, RuntimeAgent>;
	prompts: Record<string, RuntimePrompt>;
	policies?: Record<string, unknown>;
	adapters?: Record<string, RuntimeAdapter>;
	pipelines: Record<string, RuntimePipeline>;
}

export interface RuntimeAdapter {
	kind: string;
	module?: string;
	capabilities?: string[];
	[key: string]: unknown;
}

export interface RuntimeAgent {
	role?: string;
	kind?: string;
	provider?: string;
	model?: string;
	sandbox?: string;
	maxIterations?: number;
	systemPrompt?: string;
	copyToWorktree?: string[];
	branchPolicy?: string;
	completionPolicy?: string;
}

export interface RuntimePrompt {
	format: "markdown" | "text" | "json";
	template?: string;
	file?: string;
	description?: string;
}

export interface RuntimePipeline {
	kind?: "composite";
	description?: string;
	defaults?: Record<string, unknown>;
	inputs?: Record<string, unknown>;
	nodes: Record<string, RuntimePipelineNode>;
}

export interface RuntimeContainerImage {
	name: string;
	dockerfile?: string;
	context?: string;
}

export interface RuntimeRefMeta {
	ref: string;
	default?: string;
}

export interface RuntimeCloseFinalizer {
	role?: string;
	prompt?: string;
	promptOverride?: string;
}

export interface RuntimePipelineNode {
	kind?: string;
	$?: RuntimeRefMeta;
	$ref?: string;
	needs?: string[];
	inputs?: string[];
	capabilities?: string[];
	role?: string;
	prompt?: string;
	promptOverride?: string;
	finalize?: RuntimeCloseFinalizer;
	workSource?: string;
	issueTracker?: string;
	each?: string;
	mode?: "sequential" | "parallel";
	max?: number;
	maxIterations?: number;
	node?: RuntimePipelineNode;
	nodes?: Record<string, RuntimePipelineNode>;
	image?: RuntimeContainerImage;
	strategy?: string;
	command?: string;
	when?: string;
	with?: Record<string, unknown>;
	overrides?: Record<string, unknown>;
}

export interface LegacyConfigLike {
	defaultSandbox?: "docker" | "podman" | "vercel" | "no-sandbox";
	defaultModel?: string;
	defaultPipeline?: string;
	entrypoint?: string;
	defaultAgent?: string;
	maxWorkers?: number;
	maxIterations?: number;
	workSource?: string;
	workSourceSetupCommand?: string;
	workSourceCommands?: Record<string, string>;
	issueTracker?: string;
	imageNamePattern?: string;
	prompts?: Record<string, RuntimePrompt>;
	agents: Record<string, any>;
	pipelines: Record<string, any>;
}

const PROVIDER_ALIASES: Record<string, string> = {
	default: "pi",
	claude: "claude-code",
};

const SANDBOX_ALIASES: Record<string, string> = {
	default: "docker",
};

export function loadExecutionRuntimePack(path = DEFAULT_RUNTIME_PACK_PATH): ExecutionRuntimePack {
	return validateExecutionRuntimePack(JSON.parse(readFileSync(path, "utf8")));
}

export function validateExecutionRuntimePack(value: unknown): ExecutionRuntimePack {
	const pack = value as Partial<ExecutionRuntimePack>;
	const errors: string[] = [];
	if (!pack || typeof pack !== "object") {
		throw new Error("Invalid execution runtime pack:\n- runtime pack must be an object");
	}
	if (!Number.isInteger(pack.runtimeVersion) || Number(pack.runtimeVersion) < 1) errors.push("runtimeVersion must be a positive integer");
	const roles = pack.roles;
	if (!roles || typeof roles !== "object" || Object.keys(roles).length === 0) errors.push("roles must contain at least one role");
	if (!pack?.prompts || typeof pack.prompts !== "object" || Object.keys(pack.prompts).length === 0) errors.push("prompts must contain at least one prompt");
	if (!pack?.pipelines || typeof pack.pipelines !== "object" || Object.keys(pack.pipelines).length === 0) errors.push("pipelines must contain at least one pipeline");
	for (const [name, prompt] of Object.entries(pack.prompts || {})) {
		if (!prompt?.template && !prompt?.file) errors.push(`prompt '${name}' must define template or file`);
	}
	const normalizedPack: ExecutionRuntimePack = {
		...(pack as ExecutionRuntimePack),
		pipelines: {},
	};
	for (const [name, pipeline] of Object.entries(pack.pipelines || {})) {
		normalizedPack.pipelines[name] = normalizePipeline(name, pipeline as Partial<RuntimePipeline>, errors, normalizedPack);
	}
	for (const [name, pipeline] of Object.entries(normalizedPack.pipelines || {})) {
		validatePipeline(name, pipeline, errors, normalizedPack);
	}
	if (errors.length) throw new Error(`Invalid execution runtime pack:\n- ${errors.join("\n- ")}`);
	return normalizedPack;
}

const BUILT_IN_NODE_KINDS = new Set(["composite", "loop", "agent.pi", "command", "work.close", "git.worktree", "git.merge", "docker.container", "podman.container"]);
const SUPPORTED_REF_META_KEYS = new Set(["ref", "default"]);
const PROVIDER_QUALIFIED_NODE_KIND = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*$/;

function normalizePipeline(scope: string, pipeline: Partial<RuntimePipeline>, errors: string[], _pack: ExecutionRuntimePack): RuntimePipeline {
	const hasNodes = isRecord(pipeline.nodes) && Object.keys(pipeline.nodes).length > 0;
	if (!hasNodes) errors.push(`pipeline '${scope}' must define graph-native nodes`);
	if (pipeline.kind && pipeline.kind !== "composite") errors.push(`pipeline '${scope}' kind must be composite`);
	const { steps: _unsupportedSteps, ...graphPipeline } = pipeline as Partial<RuntimePipeline> & { steps?: unknown };
	return {
		...graphPipeline,
		kind: "composite",
		nodes: normalizeNodeMap(pipeline.nodes || {}),
	} as RuntimePipeline;
}

function isRecord(value: unknown): value is Record<string, any> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeNodeMap(nodes: Record<string, RuntimePipelineNode>): Record<string, RuntimePipelineNode> {
	return Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, normalizeNode(node)]));
}

function normalizeNode(node: RuntimePipelineNode): RuntimePipelineNode {
	const normalized: RuntimePipelineNode = { ...node };
	if (normalized.kind === "loop" && !normalized.mode) normalized.mode = "sequential";
	if (normalized.nodes) normalized.nodes = normalizeNodeMap(normalized.nodes);
	if (normalized.node) normalized.node = normalizeNode(normalized.node);
	return normalized;
}


function validatePipeline(scope: string, pipeline: RuntimePipeline, errors: string[], pack: ExecutionRuntimePack): void {
	if (!pipeline.nodes || Object.keys(pipeline.nodes).length === 0) errors.push(`pipeline '${scope}' must define nodes`);
	for (const [id, node] of Object.entries(pipeline.nodes || {})) validateNode(scope, id, node, errors, pack);
}

function isDynamicRefExpression(value: string): boolean {
	const trimmed = value.trim();
	return trimmed === "$" || trimmed.startsWith("$.") || /^\$\{.+\}$/.test(trimmed);
}

function validateRefNode(nodeScope: string, node: RuntimePipelineNode, errors: string[], pack: ExecutionRuntimePack): boolean {
	if (node.$ === undefined && node.$ref === undefined) return false;
	if (node.kind !== undefined) errors.push(`${nodeScope} must not combine $ref metadata with kind`);
	if (node.node !== undefined || node.nodes !== undefined) errors.push(`${nodeScope} must not combine $ref metadata with child nodes`);
	if (node.$ !== undefined && node.$ref !== undefined) errors.push(`${nodeScope} must not combine $ and $ref metadata`);
	for (const key of Object.keys(node)) {
		if (!["$", "$ref", "needs", "capabilities", "with"].includes(key)) errors.push(`${nodeScope} uses unsupported $ref node field '${key}'`);
	}
	if (node.$ref !== undefined) {
		if (typeof node.$ref !== "string" || !node.$ref.trim()) errors.push(`${nodeScope} $ref must be a non-empty string`);
		else if (!isDynamicRefExpression(node.$ref) && !pack.pipelines?.[node.$ref]) errors.push(`${nodeScope} $ref references unknown pipeline '${node.$ref}'`);
		return true;
	}
	if (!isRecord(node.$)) {
		errors.push(`${nodeScope}.$ must be an object`);
		return true;
	}
	for (const key of Object.keys(node.$)) if (!SUPPORTED_REF_META_KEYS.has(key)) errors.push(`${nodeScope} uses unsupported $ meta key '${key}'`);
	if (typeof node.$.ref !== "string" || !node.$.ref.trim()) errors.push(`${nodeScope} $.ref must be a non-empty string`);
	else if (!isDynamicRefExpression(node.$.ref) && !pack.pipelines?.[node.$.ref]) errors.push(`${nodeScope} $.ref references unknown pipeline '${node.$.ref}'`);
	if (node.$.default !== undefined) {
		if (typeof node.$.default !== "string" || !node.$.default.trim()) errors.push(`${nodeScope} $.default must be a non-empty string when provided`);
		else if (!pack.pipelines?.[node.$.default]) errors.push(`${nodeScope} $.default references unknown pipeline '${node.$.default}'`);
	}
	return true;
}

function validateNode(scope: string, id: string, node: RuntimePipelineNode, errors: string[], pack: ExecutionRuntimePack): void {
	const nodeScope = `${scope}.${id}`;
	if (validateRefNode(nodeScope, node, errors, pack)) return;
	if (!node.kind) errors.push(`${nodeScope} is missing kind`);
	else if (!BUILT_IN_NODE_KINDS.has(node.kind) && !PROVIDER_QUALIFIED_NODE_KIND.test(node.kind)) errors.push(`${nodeScope} references unknown node kind '${node.kind}'`);
	if (node.when !== undefined) {
		if (typeof node.when !== "string" || !node.when.trim()) errors.push(`${nodeScope} when must be a non-empty CEL expression string`);
		else {
			try { parseCel(node.when); }
			catch (error) { errors.push(`${nodeScope} when must parse as CEL: ${error instanceof Error ? error.message : String(error)}`); }
		}
	}
	if (node.kind === "command" && (typeof node.command !== "string" || !node.command.trim())) errors.push(`${nodeScope} command nodes must define command`);
	if (node.maxIterations !== undefined && (!Number.isInteger(node.maxIterations) || node.maxIterations < 1)) errors.push(`${nodeScope} maxIterations must be a positive integer`);
	if (node.finalize !== undefined) validateCloseFinalizer(nodeScope, node, errors, pack);
	if (node.kind === "agent.pi") {
		if (!node.role) errors.push(`${nodeScope} must reference a role`);
		if (!node.prompt) errors.push(`${nodeScope} must reference a prompt`);
	}
	if (node.kind === "loop") {
		if (node.mode === "parallel" && !node.each) errors.push(`${nodeScope} parallel loop must define each`);
		if (node.mode && !["sequential", "parallel"].includes(node.mode)) errors.push(`${nodeScope} loop mode must be sequential or parallel`);
		const hasNode = Object.prototype.hasOwnProperty.call(node, "node");
		const hasNodes = Object.prototype.hasOwnProperty.call(node, "nodes");
		if (!hasNode && !hasNodes) errors.push(`${nodeScope} loop must define node or nodes`);
		if (hasNode && hasNodes) errors.push(`${nodeScope} loop must define exactly one of node or nodes`);
	}
	if (node.kind === "composite" || node.kind === "git.worktree") {
		if (!node.nodes || Object.keys(node.nodes).length === 0) errors.push(`${nodeScope} ${node.kind} must define nodes`);
	}
	if ((node.kind === "docker.container" || node.kind === "podman.container") && !node.image?.name) errors.push(`${nodeScope} ${node.kind} image.name is required`);
	if (node.image && "strategy" in (node.image as any)) errors.push(`${nodeScope} image.strategy is not supported; use image.name with optional dockerfile`);
	if (node.role && node.role !== "default" && !pack.roles?.[node.role]) errors.push(`${nodeScope} references unknown role '${node.role}'`);
	if (node.prompt && node.prompt !== "default" && !pack.prompts?.[node.prompt]) errors.push(`${nodeScope} references unknown prompt '${node.prompt}'`);
	for (const [childId, child] of Object.entries(node.nodes || {})) validateNode(nodeScope, childId, child, errors, pack);
	if (node.node) validateNode(nodeScope, "node", node.node, errors, pack);
}

function validateCloseFinalizer(nodeScope: string, node: RuntimePipelineNode, errors: string[], pack: ExecutionRuntimePack): void {
	if (node.kind !== "work.close") errors.push(`${nodeScope} finalize is supported only on work.close nodes`);
	if (!isRecord(node.finalize)) {
		errors.push(`${nodeScope} finalize must be an object`);
		return;
	}
	const finalizer = node.finalize;
	const hasPrompt = typeof finalizer.prompt === "string" && finalizer.prompt.trim().length > 0;
	const hasPromptOverride = typeof finalizer.promptOverride === "string" && finalizer.promptOverride.trim().length > 0;
	if (!hasPrompt && !hasPromptOverride) errors.push(`${nodeScope} finalize must define prompt or promptOverride`);
	if (finalizer.role !== undefined && finalizer.role !== "default" && !pack.roles?.[finalizer.role]) errors.push(`${nodeScope} finalize references unknown role '${finalizer.role}'`);
	if (finalizer.prompt !== undefined && finalizer.prompt !== "default" && !pack.prompts?.[finalizer.prompt]) errors.push(`${nodeScope} finalize references unknown prompt '${finalizer.prompt}'`);
}

export function listRuntimePipelines(pack = loadExecutionRuntimePack()): Array<{ name: string; description: string }> {
	return Object.entries(pack.pipelines).map(([name, pipeline]) => ({ name, description: pipeline.description || `${name} pipeline` })).sort((a, b) => a.name.localeCompare(b.name));
}

export function listRuntimeAgents(pack = loadExecutionRuntimePack()): Array<{ name: string; description: string }> {
	return Object.entries(pack.roles).map(([name, agent]) => ({ name, description: agent.systemPrompt || `${agent.role || name} agent` })).sort((a, b) => a.name.localeCompare(b.name));
}

export function getRuntimeAdapterCapabilities(pack: ExecutionRuntimePack, adapterId: string): string[] {
	const adapter = pack.adapters?.[adapterId];
	return Array.isArray(adapter?.capabilities) ? adapter.capabilities.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

export function collectRuntimeAdapterCapabilities(pack: ExecutionRuntimePack, adapterIds: string[]): string[] {
	return [...new Set(adapterIds.flatMap((adapterId) => [adapterId, `adapter:${adapterId}`, ...getRuntimeAdapterCapabilities(pack, adapterId)]))];
}

export function runtimeToSandcastleConfig(pack = loadExecutionRuntimePack(), defaults: Partial<LegacyConfigLike> = {}): LegacyConfigLike {
	const defaultSandbox = normalizeSandbox(String(defaults.defaultSandbox || pack.defaults?.sandboxProvider || "docker"));
	const defaultModel = String(defaults.defaultModel || pack.defaults?.model || "Agent Default");
	const defaultAgent = String(defaults.defaultAgent || pack.defaults?.agentProvider || "pi");
	const maxWorkers = Number(defaults.maxWorkers || pack.defaults?.maxWorkers || 5);
	const maxIterations = Number(defaults.maxIterations || pack.defaults?.maxIterations || 10);
	const agents: Record<string, any> = {};
	const pipelines: Record<string, any> = {};
	for (const [name, agent] of Object.entries(pack.roles)) {
		agents[name] = {
			name,
			description: agent.role ? `${agent.role} role` : `${name} role`,
			kind: agent.kind,
			provider: agent.provider && agent.provider !== "default" ? normalizeProvider(String(agent.provider)) : undefined,
			model: agent.model && agent.model !== "default" ? String(agent.model) : undefined,
			sandbox: agent.sandbox && agent.sandbox !== "default" ? normalizeSandbox(String(agent.sandbox)) : undefined,
			systemPrompt: agent.systemPrompt,
			maxIterations: agent.maxIterations,
			copyToWorktree: agent.copyToWorktree,
		};
	}
	for (const [name, pipeline] of Object.entries(pack.pipelines)) {
		const branchPolicy = String(pipeline.defaults?.branchPolicy || pack.defaults?.branchPolicy || "branch-per-run");
		pipelines[name] = {
			description: pipeline.description,
			kind: pipeline.kind || "composite",
			nodes: JSON.parse(JSON.stringify(pipeline.nodes || {})),
			branchStrategy: branchPolicy === "merge-to-head" ? { type: "merge-to-head" } : { type: "branch", branch: `sandcastle/${name}` },
			model: defaultModel,
			copyToWorktree: ["node_modules"],
		};
	}
	return {
		defaultSandbox,
		defaultModel,
		defaultPipeline: defaults.defaultPipeline || "simple-loop",
		entrypoint: defaults.entrypoint || String(pack.defaults?.entrypoint || "work-process-waves"),
		defaultAgent,
		maxWorkers,
		maxIterations,
		workSource: defaults.workSource || defaults.issueTracker || String(pack.defaults?.workSource || pack.defaults?.issueTracker || "github-issues"),
		workSourceSetupCommand: defaults.workSourceSetupCommand,
		workSourceCommands: (defaults as any).workSourceCommands,
		imageNamePattern: defaults.imageNamePattern || "sandcastle:<repo-dir-name>",
		prompts: pack.prompts,
		agents,
		pipelines,
	};
}

function normalizeProvider(provider: string): string {
	return PROVIDER_ALIASES[provider] || provider;
}

function normalizeSandbox(sandbox: string): "docker" | "podman" | "vercel" | "no-sandbox" {
	const normalized = SANDBOX_ALIASES[sandbox] || sandbox;
	if (["docker", "podman", "vercel", "no-sandbox"].includes(normalized)) return normalized as any;
	return "docker";
}

function normalizeDefault(value: unknown, fallback: string): string {
	if (!value || value === "default") return fallback;
	return String(value);
}
