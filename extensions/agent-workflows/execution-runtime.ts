import { readFileSync } from "node:fs";
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
	adapters?: Record<string, unknown>;
	pipelines: Record<string, RuntimePipeline>;
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
	steps: RuntimePipelineStep[];
}

export interface RuntimeContainerImage {
	name: string;
	dockerfile?: string;
	context?: string;
}

export interface RuntimePipelineNode {
	kind: string;
	needs?: string[];
	inputs?: string[];
	role?: string;
	prompt?: string;
	promptOverride?: string;
	workSource?: string;
	issueTracker?: string;
	each?: string;
	mode?: "sequential" | "parallel";
	max?: number;
	node?: RuntimePipelineNode;
	nodes?: Record<string, RuntimePipelineNode>;
	image?: RuntimeContainerImage;
	strategy?: string;
	when?: string;
	with?: Record<string, unknown>;
	overrides?: Record<string, unknown>;
}

export interface RuntimePipelineStep {
	id: string;
	kind: string;
	needs?: string[];
	role?: string;
	prompt?: string;
	promptOverride?: string;
	workSource?: string;
	issueTracker?: string;
	limit?: number;
	over?: string;
	concurrency?: number;
	step?: RuntimePipelineStep;
	strategy?: string;
	when?: string;
	with?: Record<string, unknown>;
	overrides?: Record<string, unknown>;
}

export interface LegacyConfigLike {
	defaultSandbox?: "docker" | "podman" | "vercel" | "no-sandbox";
	defaultModel?: string;
	defaultPipeline?: string;
	defaultAgent?: string;
	maxWorkers?: number;
	maxIterations?: number;
	workSource?: string;
	issueTracker?: string;
	imageNamePattern?: string;
	prompts?: Record<string, RuntimePrompt>;
	agents: Record<string, any>;
	chains: Record<string, any[]>;
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

const BUILT_IN_STEP_KINDS = new Set(["planWork", "runRole", "selectWork", "fanOut", "fanIn", "review", "merge", "postProcess", "gate"]);
const BUILT_IN_NODE_KINDS = new Set(["composite", "loop", "agent.pi", "git.worktree", "git.merge", "docker.container", "podman.container"]);
const PROVIDER_QUALIFIED_STEP_KIND = /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9_-]*$/;
const PROVIDER_QUALIFIED_NODE_KIND = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*$/;

function normalizePipeline(scope: string, pipeline: Partial<RuntimePipeline>, errors: string[], pack: ExecutionRuntimePack): RuntimePipeline {
	const hasSteps = Array.isArray(pipeline.steps) && pipeline.steps.length > 0;
	const hasNodes = isRecord(pipeline.nodes) && Object.keys(pipeline.nodes).length > 0;
	if (!hasSteps && !hasNodes) errors.push(`pipeline '${scope}' must define nodes or legacy steps`);
	if (pipeline.kind && pipeline.kind !== "composite") errors.push(`pipeline '${scope}' kind must be composite`);
	const nodes = hasNodes ? normalizeNodeMap(pipeline.nodes || {}) : legacyStepsToNodes(pipeline.steps || [], pack);
	const steps = hasSteps ? (pipeline.steps || []) : nodesToLegacySteps(nodes, pack).filter(Boolean) as RuntimePipelineStep[];
	return {
		...pipeline,
		kind: "composite",
		nodes,
		steps,
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

function legacyStepsToNodes(steps: RuntimePipelineStep[], pack: ExecutionRuntimePack): Record<string, RuntimePipelineNode> {
	return Object.fromEntries(steps.map((step, index) => [step.id || `step-${index + 1}`, legacyStepToNode(step, pack)]));
}

function legacyStepToNode(step: RuntimePipelineStep, pack: ExecutionRuntimePack): RuntimePipelineNode {
	const common = {
		needs: step.needs,
		prompt: step.prompt,
		promptOverride: step.promptOverride,
		workSource: step.workSource,
		issueTracker: step.issueTracker,
		strategy: step.strategy,
		when: step.when,
		with: step.with,
		overrides: step.overrides,
	};
	if (step.kind === "fanOut") {
		return normalizeNode({
			kind: "loop",
			needs: step.needs,
			each: step.over,
			mode: "parallel",
			max: step.concurrency || step.limit,
			node: step.step ? legacyStepToNode(step.step, pack) : undefined,
			when: step.when,
			with: step.with,
			overrides: step.overrides,
		});
	}
	if (step.kind === "merge") {
		return normalizeNode({ kind: "git.merge", role: step.role, ...common });
	}
	if (step.kind === "planWork") {
		return normalizeNode({ kind: "agent.pi", role: step.role || trySelectRuntimePlanWorkRoleName(pack), ...common });
	}
	return normalizeNode({ kind: "agent.pi", role: step.role, ...common });
}

function nodesToLegacySteps(nodes: Record<string, RuntimePipelineNode>, pack: ExecutionRuntimePack, prefix?: string): RuntimePipelineStep[] {
	return orderedNodeEntries(nodes).flatMap(([id, node]) => nodeToLegacySteps(prefix ? `${prefix}.${id}` : id, node, pack));
}

function orderedNodeEntries(nodes: Record<string, RuntimePipelineNode>): Array<[string, RuntimePipelineNode]> {
	const entries = Object.entries(nodes);
	const emitted = new Set<string>();
	const remaining = new Set(entries.map(([id]) => id));
	const ordered: Array<[string, RuntimePipelineNode]> = [];
	while (remaining.size > 0) {
		let progressed = false;
		for (const [id, node] of entries) {
			if (!remaining.has(id)) continue;
			const localNeeds = (node.needs || []).filter((need) => Object.prototype.hasOwnProperty.call(nodes, need));
			if (!localNeeds.every((need) => emitted.has(need))) continue;
			ordered.push([id, node]);
			emitted.add(id);
			remaining.delete(id);
			progressed = true;
		}
		if (!progressed) {
			for (const [id, node] of entries) {
				if (!remaining.has(id)) continue;
				ordered.push([id, node]);
				remaining.delete(id);
			}
		}
	}
	return ordered;
}

function nodeToLegacySteps(id: string, node: RuntimePipelineNode, pack: ExecutionRuntimePack): RuntimePipelineStep[] {
	if (node.kind === "loop") {
		const nested = loopNestedLegacyStep(id, node, pack);
		return [{
			id,
			kind: "fanOut",
			needs: node.needs,
			over: node.each,
			concurrency: node.mode === "parallel" ? node.max : undefined,
			limit: node.mode !== "parallel" ? node.max : undefined,
			step: nested,
			when: node.when,
			with: node.with,
			overrides: node.overrides,
		}];
	}
	if (node.kind === "git.merge") {
		return [nodeToStep(id, node, "merge", node.role)];
	}
	if (node.kind === "composite" || node.kind === "git.worktree") {
		return nodesToLegacySteps(node.nodes || {}, pack, id);
	}
	if (node.kind === "agent.pi") {
		const roleKind = node.role && node.role !== "default" ? pack.roles?.[node.role]?.kind : undefined;
		const legacyKind = BUILT_IN_STEP_KINDS.has(String(roleKind)) ? String(roleKind) : "runRole";
		return [nodeToStep(id, node, legacyKind, legacyKind === "planWork" ? undefined : node.role)];
	}
	if (PROVIDER_QUALIFIED_NODE_KIND.test(node.kind) && node.role) {
		return [nodeToStep(id, node, "runRole", node.role)];
	}
	return [];
}

function loopNestedLegacyStep(id: string, node: RuntimePipelineNode, pack: ExecutionRuntimePack): RuntimePipelineStep | undefined {
	if (node.node) return nodeToLegacySteps(`${id}-one`, node.node, pack)[0];
	const [childId, childNode] = orderedNodeEntries(node.nodes || {})[0] || [];
	return childId && childNode ? nodeToLegacySteps(`${id}.${childId}`, childNode, pack)[0] : undefined;
}

function nodeToStep(id: string, node: RuntimePipelineNode, kind: string, role?: string): RuntimePipelineStep {
	return {
		id,
		kind,
		needs: node.needs,
		role,
		prompt: node.prompt,
		promptOverride: node.promptOverride,
		workSource: node.workSource,
		issueTracker: node.issueTracker,
		strategy: node.strategy,
		when: node.when,
		with: node.with,
		overrides: node.overrides,
	};
}

function trySelectRuntimePlanWorkRoleName(pack: ExecutionRuntimePack): string | undefined {
	const matches = Object.entries(pack.roles || {}).filter(([, role]) => role?.kind === "planWork").map(([name]) => name);
	return matches.length === 1 ? matches[0] : undefined;
}

function countLegacyStepsForLoopChild(node: RuntimePipelineNode): number {
	if (node.node) return countLegacyStepsForNode(node.node);
	return Object.values(node.nodes || {}).reduce((count, child) => count + countLegacyStepsForNode(child), 0);
}

function countLegacyStepsForNode(node: RuntimePipelineNode): number {
	if (node.kind === "composite" || node.kind === "git.worktree") return Object.values(node.nodes || {}).reduce((count, child) => count + countLegacyStepsForNode(child), 0);
	if (node.kind === "agent.pi" || node.kind === "git.merge" || node.kind === "loop") return 1;
	if (PROVIDER_QUALIFIED_NODE_KIND.test(node.kind) && node.role) return 1;
	return 0;
}

function validatePipeline(scope: string, pipeline: RuntimePipeline, errors: string[], pack: ExecutionRuntimePack): void {
	if (!pipeline.nodes || Object.keys(pipeline.nodes).length === 0) errors.push(`pipeline '${scope}' must define nodes`);
	for (const [id, node] of Object.entries(pipeline.nodes || {})) validateNode(scope, id, node, errors, pack);
	if (!Array.isArray(pipeline.steps) || pipeline.steps.length === 0) errors.push(`pipeline '${scope}' must define legacy-compatible steps`);
	for (const step of pipeline.steps || []) validateStep(scope, step, errors, pack);
}

function validateNode(scope: string, id: string, node: RuntimePipelineNode, errors: string[], pack: ExecutionRuntimePack): void {
	const nodeScope = `${scope}.${id}`;
	if (!node.kind) errors.push(`${nodeScope} is missing kind`);
	else if (!BUILT_IN_NODE_KINDS.has(node.kind) && !PROVIDER_QUALIFIED_NODE_KIND.test(node.kind)) errors.push(`${nodeScope} references unknown node kind '${node.kind}'`);
	if (node.kind === "agent.pi") {
		if (!node.role) errors.push(`${nodeScope} must reference a role`);
		if (!node.prompt) errors.push(`${nodeScope} must reference a prompt`);
	}
	if (node.kind === "loop") {
		if (!node.each) errors.push(`${nodeScope} loop must define each`);
		if (node.mode && !["sequential", "parallel"].includes(node.mode)) errors.push(`${nodeScope} loop mode must be sequential or parallel`);
		const hasNode = Object.prototype.hasOwnProperty.call(node, "node");
		const hasNodes = Object.prototype.hasOwnProperty.call(node, "nodes");
		if (!hasNode && !hasNodes) errors.push(`${nodeScope} loop must define node or nodes`);
		if (hasNode && hasNodes) errors.push(`${nodeScope} loop must define exactly one of node or nodes`);
		const nestedStepCount = countLegacyStepsForLoopChild(node);
		if (nestedStepCount > 1) errors.push(`${nodeScope} loop compiles to ${nestedStepCount} nested legacy steps, but legacy fanOut supports exactly one nested step; use a single child node until graph execution is available`);
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

function validateStep(scope: string, step: RuntimePipelineStep, errors: string[], pack: ExecutionRuntimePack): void {
	if (!step.id) errors.push(`${scope} step is missing id`);
	if (!step.kind) errors.push(`${scope}.${step.id || "?"} is missing kind`);
	else if (!BUILT_IN_STEP_KINDS.has(step.kind) && !PROVIDER_QUALIFIED_STEP_KIND.test(step.kind)) errors.push(`${scope}.${step.id || "?"} references unknown step kind '${step.kind}'`);
	if ((step.kind === "runRole" || step.kind === "review") && !step.role) errors.push(`${scope}.${step.id} must reference a role`);
	if ((step.kind === "runRole" || step.kind === "review") && !step.prompt) errors.push(`${scope}.${step.id} must reference a prompt`);
	if (step.kind === "planWork") {
		if (step.role) errors.push(`${scope}.${step.id} planWork must not reference a role; the planning role is selected by kind planWork`);
		const planWorkRoles = Object.entries(pack.roles || {}).filter(([, role]) => role?.kind === "planWork").map(([name]) => name);
		if (planWorkRoles.length !== 1) errors.push(`${scope}.${step.id} requires exactly one role with kind planWork`);
	}
	if (step.role && step.role !== "default" && !pack.roles?.[step.role]) errors.push(`${scope}.${step.id} references unknown role '${step.role}'`);
	if (step.prompt && step.prompt !== "default" && !pack.prompts?.[step.prompt]) errors.push(`${scope}.${step.id} references unknown prompt '${step.prompt}'`);
	if (step.kind === "fanOut") {
		if (!step.over) errors.push(`${scope}.${step.id} fanOut must define over`);
		if (!step.step) errors.push(`${scope}.${step.id} fanOut must define nested step`);
		else validateStep(scope, step.step, errors, pack);
	}
}

export function listRuntimePipelines(pack = loadExecutionRuntimePack()): Array<{ name: string; description: string }> {
	return Object.entries(pack.pipelines).map(([name, pipeline]) => ({ name, description: pipeline.description || `${name} pipeline` })).sort((a, b) => a.name.localeCompare(b.name));
}

export function listRuntimeAgents(pack = loadExecutionRuntimePack()): Array<{ name: string; description: string }> {
	return Object.entries(pack.roles).map(([name, agent]) => ({ name, description: agent.systemPrompt || `${agent.role || name} agent` })).sort((a, b) => a.name.localeCompare(b.name));
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
			steps: compileRuntimeSteps(pipeline.steps, pack),
		};
	}
	return {
		defaultSandbox,
		defaultModel,
		defaultPipeline: defaults.defaultPipeline || "simple-loop",
		defaultAgent,
		maxWorkers,
		maxIterations,
		workSource: defaults.workSource || defaults.issueTracker || String(pack.defaults?.workSource || pack.defaults?.issueTracker || "github-issues"),
		imageNamePattern: defaults.imageNamePattern || "sandcastle:<repo-dir-name>",
		prompts: pack.prompts,
		agents,
		chains: {},
		pipelines,
	};
}

export function compileRuntimeSteps(steps: RuntimePipelineStep[], pack = loadExecutionRuntimePack()): any[] {
	const compiled: any[] = [];
	for (const step of steps) {
		if (step.kind === "planWork") {
			compiled.push(compilePlanWorkStep(step, pack));
			continue;
		}
		if (step.kind === "runRole" || step.kind === "review") {
			compiled.push(compileAgentStep(step, pack));
			continue;
		}
		if (step.kind === "fanOut" && step.step && (step.step.kind === "runRole" || step.step.kind === "review")) {
			compiled.push(compileAgentStep(step.step, pack));
			continue;
		}
		if (step.kind === "merge") compiled.push(compileAgentStep({ ...step, role: step.role || "merger", prompt: step.prompt || "merge-work" } as RuntimePipelineStep, pack));
	}
	return compiled.length ? compiled : [{ role: Object.keys(pack.roles)[0], prompt: "$INPUT", maxIterations: 1 }];
}

function compilePlanWorkStep(step: RuntimePipelineStep, pack: ExecutionRuntimePack): any {
	const role = selectRuntimePlanWorkRoleName(pack);
	return compileAgentStep({ ...step, role, kind: "planWork" }, pack);
}

function compileAgentStep(step: RuntimePipelineStep, pack: ExecutionRuntimePack): any {
	const agent = pack.roles[step.role || ""] || {};
	return {
		kind: step.kind,
		role: step.role,
		description: `${step.role || "Step"} ${step.kind || "runRole"}`,
		prompt: step.prompt || `$INPUT`,
		...(step.overrides?.maxIterations || agent.maxIterations ? { maxIterations: Number(step.overrides?.maxIterations || agent.maxIterations) } : {}),
		copyToWorktree: agent.copyToWorktree,
	};
}

function selectRuntimePlanWorkRoleName(pack: ExecutionRuntimePack): string {
	const matches = Object.entries(pack.roles || {}).filter(([, role]) => role?.kind === "planWork").map(([name]) => name);
	if (matches.length === 1) return matches[0]!;
	if (matches.length > 1) throw new Error(`Multiple planWork roles configured: ${matches.join(", ")}. Exactly one role may have kind: planWork.`);
	throw new Error("No planWork role configured. Runtime planWork nodes require exactly one role with kind: planWork.");
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
