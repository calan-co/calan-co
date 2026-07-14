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
	description?: string;
	defaults?: Record<string, unknown>;
	inputs?: Record<string, unknown>;
	steps: RuntimePipelineStep[];
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
	for (const [name, pipeline] of Object.entries(pack.pipelines || {})) {
		if (!Array.isArray(pipeline.steps) || pipeline.steps.length === 0) errors.push(`pipeline '${name}' must define steps`);
		for (const step of pipeline.steps || []) validateStep(name, step, errors, pack as ExecutionRuntimePack);
	}
	if (errors.length) throw new Error(`Invalid execution runtime pack:\n- ${errors.join("\n- ")}`);
	return pack as ExecutionRuntimePack;
}

const BUILT_IN_STEP_KINDS = new Set(["planWork", "runRole", "selectWork", "fanOut", "fanIn", "review", "merge", "postProcess", "gate"]);
const PROVIDER_QUALIFIED_STEP_KIND = /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9_-]*$/;

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
	const agents: Record<string, any> = {};
	const pipelines: Record<string, any> = {};
	for (const [name, agent] of Object.entries(pack.roles)) {
		agents[name] = {
			name,
			description: agent.role ? `${agent.role} role` : `${name} role`,
			kind: agent.kind,
			provider: normalizeProvider(normalizeDefault(agent.provider, defaultAgent)),
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
			compiled.push({ ...compileAgentStep(step.step, pack), maxIterations: step.concurrency || compileAgentStep(step.step, pack).maxIterations });
			continue;
		}
		if (step.kind === "merge" && step.role) compiled.push(compileAgentStep(step as RuntimePipelineStep, pack));
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
		maxIterations: Number(step.overrides?.maxIterations || agent.maxIterations || 1),
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
