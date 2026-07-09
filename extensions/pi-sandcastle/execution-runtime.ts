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
	issueTrackers?: Record<string, unknown>;
	roles?: Record<string, RuntimeAgent>;
	agents: Record<string, RuntimeAgent>;
	prompts: Record<string, RuntimePrompt>;
	policies?: Record<string, unknown>;
	adapters?: Record<string, unknown>;
	stepModules?: Record<string, RuntimeStepModule>;
	pipelines: Record<string, RuntimePipeline>;
}

export interface RuntimeAgent {
	role?: string;
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
	kind: "runAgent" | "selectWork" | "fanOut" | "fanIn" | "review" | "merge" | "postProcess" | "gate";
	needs?: string[];
	agent?: string;
	prompt?: string;
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

export type RuntimeStepModule = Omit<RuntimePipelineStep, "id"> & { id?: string };

export interface LegacyConfigLike {
	defaultSandbox?: "docker" | "podman" | "vercel" | "no-sandbox";
	defaultModel?: string;
	defaultPipeline?: string;
	defaultAgent?: string;
	issueTracker?: string;
	imageNamePattern?: string;
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
	const roles = pack.roles || pack.agents;
	if (!roles || typeof roles !== "object" || Object.keys(roles).length === 0) errors.push("roles must contain at least one role");
	else pack.agents = roles;
	if (!pack?.prompts || typeof pack.prompts !== "object" || Object.keys(pack.prompts).length === 0) errors.push("prompts must contain at least one prompt");
	if (!pack?.pipelines || typeof pack.pipelines !== "object" || Object.keys(pack.pipelines).length === 0) errors.push("pipelines must contain at least one pipeline");
	for (const [name, prompt] of Object.entries(pack.prompts || {})) {
		if (!prompt?.template && !prompt?.file) errors.push(`prompt '${name}' must define template or file`);
	}
	for (const [name, pipeline] of Object.entries(pack.pipelines || {})) {
		if (!Array.isArray(pipeline.steps) || pipeline.steps.length === 0) errors.push(`pipeline '${name}' must define steps`);
		for (const step of pipeline.steps || []) validateStep(name, step, errors, pack as ExecutionRuntimePack);
	}
	for (const [name, module] of Object.entries(pack.stepModules || {})) {
		validateStep(`stepModules.${name}`, { id: module.id || name, ...module } as RuntimePipelineStep, errors, pack as ExecutionRuntimePack);
	}
	if (errors.length) throw new Error(`Invalid execution runtime pack:\n- ${errors.join("\n- ")}`);
	return pack as ExecutionRuntimePack;
}

function validateStep(scope: string, step: RuntimePipelineStep, errors: string[], pack: ExecutionRuntimePack): void {
	if (!step.id) errors.push(`${scope} step is missing id`);
	if (!step.kind) errors.push(`${scope}.${step.id || "?"} is missing kind`);
	if ((step.kind === "runAgent" || step.kind === "review") && !step.agent) errors.push(`${scope}.${step.id} must reference an agent`);
	if ((step.kind === "runAgent" || step.kind === "review") && !step.prompt) errors.push(`${scope}.${step.id} must reference a prompt`);
	if (step.agent && step.agent !== "default" && !pack.agents?.[step.agent]) errors.push(`${scope}.${step.id} references unknown agent '${step.agent}'`);
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
	return Object.entries(pack.agents).map(([name, agent]) => ({ name, description: agent.systemPrompt || `${agent.role || name} agent` })).sort((a, b) => a.name.localeCompare(b.name));
}

export function runtimeToSandcastleConfig(pack = loadExecutionRuntimePack(), defaults: Partial<LegacyConfigLike> = {}): LegacyConfigLike {
	const defaultSandbox = normalizeSandbox(String(defaults.defaultSandbox || pack.defaults?.sandboxProvider || "docker"));
	const defaultModel = String(defaults.defaultModel || pack.defaults?.model || "Agent Default");
	const defaultAgent = String(defaults.defaultAgent || pack.defaults?.agentProvider || "pi");
	const agents: Record<string, any> = {};
	const pipelines: Record<string, any> = {};
	for (const [name, agent] of Object.entries(pack.agents)) {
		agents[name] = {
			name,
			description: agent.role ? `${agent.role} role` : `${name} role`,
			provider: normalizeProvider(normalizeDefault(agent.provider, defaultAgent)),
			model: normalizeDefault(agent.model, defaultModel),
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
		issueTracker: defaults.issueTracker || String(pack.defaults?.issueTracker || "github-issues"),
		imageNamePattern: defaults.imageNamePattern || "sandcastle:<repo-dir-name>",
		agents,
		chains: {},
		pipelines,
	};
}

export function compileRuntimeSteps(steps: RuntimePipelineStep[], pack = loadExecutionRuntimePack()): any[] {
	const compiled: any[] = [];
	for (const step of steps) {
		if (step.kind === "runAgent" || step.kind === "review") {
			compiled.push(compileAgentStep(step, pack));
			continue;
		}
		if (step.kind === "fanOut" && step.step && (step.step.kind === "runAgent" || step.step.kind === "review")) {
			compiled.push({ ...compileAgentStep(step.step, pack), maxIterations: step.concurrency || compileAgentStep(step.step, pack).maxIterations });
			continue;
		}
		if (step.kind === "merge" && step.agent) compiled.push(compileAgentStep(step as RuntimePipelineStep, pack));
	}
	return compiled.length ? compiled : [{ agent: Object.keys(pack.agents)[0], prompt: "$INPUT", maxIterations: 1 }];
}

function compileAgentStep(step: RuntimePipelineStep, pack: ExecutionRuntimePack): any {
	const agent = pack.agents[step.agent || ""] || {};
	const prompt = pack.prompts[step.prompt || ""];
	return {
		agent: step.agent,
		prompt: prompt?.template || `$INPUT`,
		maxIterations: Number(step.overrides?.maxIterations || agent.maxIterations || 1),
		copyToWorktree: agent.copyToWorktree,
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
