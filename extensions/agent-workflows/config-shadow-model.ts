import { ShadowModelBase } from "./shadow-model.ts";
import type { ShadowChange } from "./shadow-model.ts";

export interface ConfigAgentDef {
	name: string;
	description?: string;
	model?: string;
	sandbox?: "docker" | "podman" | "vercel" | "no-sandbox";
	provider?: "claude" | "claude-code" | "pi" | "codex" | "cursor" | "opencode" | "copilot";
	systemPrompt?: string;
	maxIterations?: number;
	branch?: string;
	copyToWorktree?: string[];
}

export interface ConfigChainStep { role: string; prompt: string }
export interface ConfigPipelineStep { role: string; description?: string; prompt: string; sandbox?: ConfigAgentDef["sandbox"]; model?: string; maxIterations?: number; copyToWorktree?: string[]; [key: string]: unknown }
export interface ConfigPipelineNodeDef { kind?: string; needs?: string[]; role?: string; prompt?: string; promptOverride?: string; nodes?: Record<string, ConfigPipelineNodeDef>; [key: string]: unknown }
export interface ConfigPipelineDef { description?: string; kind?: string; needs?: string[]; branchStrategy?: Record<string, unknown>; sandbox?: ConfigAgentDef["sandbox"]; model?: string; copyToWorktree?: string[]; nodes?: Record<string, ConfigPipelineNodeDef>; steps?: ConfigPipelineStep[]; [key: string]: unknown }

export interface ConfigShadowSnapshot {
	defaultSandbox?: ConfigAgentDef["sandbox"];
	defaultModel?: string;
	defaultPipeline?: string;
	defaultAgent?: string;
	maxWorkers?: number;
	maxIterations?: number;
	workSource?: string;
	workSourceSetupCommand?: string;
	issueTracker?: string;
	issueTrackerSetupCommand?: string;
	imageNamePattern?: string;
	agents: Record<string, ConfigAgentDef>;
	chains: Record<string, ConfigChainStep[]>;
	pipelines: Record<string, ConfigPipelineDef>;
}

export type ConfigShadowChange = ShadowChange<ConfigShadowSnapshot>;

function isGraphPipeline(pipeline: ConfigPipelineDef | undefined): boolean {
	return Boolean(pipeline?.nodes && Object.keys(pipeline.nodes).length > 0);
}

function setNestedValue(root: Record<string, unknown>, parts: string[], value: unknown): void {
	let current: Record<string, unknown> = root;
	for (const part of parts.slice(0, -1)) {
		if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part])) current[part] = {};
		current = current[part] as Record<string, unknown>;
	}
	current[parts.at(-1)!] = value;
}

function renameRoleReferences(value: unknown, oldName: string, newName: string): void {
	if (Array.isArray(value)) {
		for (const entry of value) renameRoleReferences(entry, oldName, newName);
		return;
	}
	if (!value || typeof value !== "object") return;
	const record = value as Record<string, unknown>;
	if (record.role === oldName) record.role = newName;
	for (const entry of Object.values(record)) renameRoleReferences(entry, oldName, newName);
}

export class ConfigShadowModel extends ShadowModelBase<ConfigShadowSnapshot> {
	private state: ConfigShadowSnapshot;

	constructor(initial: ConfigShadowSnapshot) {
		super(initial);
		this.state = JSON.parse(JSON.stringify(initial));
	}

	snapshot(): ConfigShadowSnapshot {
		return JSON.parse(JSON.stringify(this.state));
	}

	get value(): ConfigShadowSnapshot {
		return this.state;
	}

	setConfigValue(path: string, value: unknown): void {
		const before = this.capture();
		const parts = path.split(".");
		if (parts.length === 1) (this.state as any)[parts[0]] = value;
		else if (parts[0] === "roles" && parts.length === 3) {
			this.state.agents[parts[1]] ||= { name: parts[1] };
			if (value === "default" && ["model", "sandbox"].includes(parts[2])) delete (this.state.agents[parts[1]] as any)[parts[2]];
			else (this.state.agents[parts[1]] as any)[parts[2]] = value;
		} else if (parts[0] === "pipelines" && parts.length === 3) {
			this.state.pipelines[parts[1]] ||= { steps: [] };
			(this.state.pipelines[parts[1]] as any)[parts[2]] = value;
		} else if (parts[0] === "pipelines" && parts[2] === "nodes" && parts.length >= 5) {
			this.state.pipelines[parts[1]] ||= { kind: "composite", nodes: {} };
			this.state.pipelines[parts[1]].kind ||= "composite";
			this.state.pipelines[parts[1]].nodes ||= {};
			setNestedValue(this.state.pipelines[parts[1]] as Record<string, unknown>, parts.slice(2), value);
		} else if (parts[0] === "pipelines" && parts[2] === "steps" && parts.length === 5) {
			this.state.pipelines[parts[1]] ||= { steps: [] };
			if (isGraphPipeline(this.state.pipelines[parts[1]])) throw new Error(`Pipeline '${parts[1]}' is graph-native; edit nodes instead of legacy steps.`);
			const index = Number(parts[3]);
			this.state.pipelines[parts[1]].steps ||= [];
			this.state.pipelines[parts[1]].steps![index] ||= { role: "worker", description: "Worker step", prompt: "Complete the requested task." };
			if (value === "default" && ["model", "sandbox", "maxIterations"].includes(parts[4])) delete (this.state.pipelines[parts[1]].steps![index] as any)[parts[4]];
			else (this.state.pipelines[parts[1]].steps![index] as any)[parts[4]] = value;
		}
		this.emit("set-config", `Set ${path}`, before, { path, value });
	}

	addPipelineStep(pipelineName: string): void {
		const before = this.capture();
		this.state.pipelines[pipelineName] ||= { steps: [] };
		if (isGraphPipeline(this.state.pipelines[pipelineName])) throw new Error(`Pipeline '${pipelineName}' is graph-native; add graph nodes instead of legacy steps.`);
		this.state.pipelines[pipelineName].steps ||= [];
		this.state.pipelines[pipelineName].steps!.push({ role: "worker", description: "Worker step", prompt: "Complete the requested task." });
		this.emit("add-pipeline-step", `Add step to pipeline ${pipelineName}`, before, { pipelineName });
	}

	deletePipelineStep(pipelineName: string, index: number): void {
		const before = this.capture();
		if (isGraphPipeline(this.state.pipelines[pipelineName])) throw new Error(`Pipeline '${pipelineName}' is graph-native; delete graph nodes instead of legacy steps.`);
		this.state.pipelines[pipelineName]?.steps?.splice(index, 1);
		this.emit("delete-pipeline-step", `Delete step ${index + 1} from pipeline ${pipelineName}`, before, { pipelineName, index });
	}

	addAgent(name: string): void {
		const before = this.capture();
		this.state.agents[name] = { name, description: `${name} role`, provider: "pi", maxIterations: 1 };
		this.emit("add-agent", `Add role ${name}`, before, { name });
	}

	renameAgent(oldName: string, newName: string): void {
		const before = this.capture();
		this.state.agents[newName] = this.state.agents[oldName] || { name: newName };
		this.state.agents[newName].name = newName;
		delete this.state.agents[oldName];
		for (const chain of Object.values(this.state.chains)) for (const step of chain) if (step.role === oldName) step.role = newName;
		for (const pipeline of Object.values(this.state.pipelines)) renameRoleReferences(pipeline, oldName, newName);
		this.emit("rename-agent", `Rename role ${oldName} → ${newName}`, before, { oldName, newName });
	}

	deleteAgent(name: string): void {
		const before = this.capture();
		delete this.state.agents[name];
		this.emit("delete-agent", `Delete role ${name}`, before, { name });
	}


	addPipeline(name: string): void {
		const before = this.capture();
		this.state.pipelines[name] = {
			description: `${name} graph pipeline`,
			kind: "composite",
			nodes: {
				workspace: {
					kind: "git.worktree",
					nodes: {
						run: { kind: "agent.pi", role: "worker", prompt: "blank" },
					},
				},
			},
		};
		this.emit("add-pipeline", `Add pipeline ${name}`, before, { name });
	}

	renamePipeline(oldName: string, newName: string): void {
		const before = this.capture();
		this.state.pipelines[newName] = this.state.pipelines[oldName] || { steps: [] };
		delete this.state.pipelines[oldName];
		this.emit("rename-pipeline", `Rename pipeline ${oldName} → ${newName}`, before, { oldName, newName });
	}

	deletePipeline(name: string): void {
		const before = this.capture();
		delete this.state.pipelines[name];
		this.emit("delete-pipeline", `Delete pipeline ${name}`, before, { name });
	}
}
