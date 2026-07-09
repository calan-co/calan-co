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
export interface ConfigPipelineStep { role: string; prompt: string; sandbox?: ConfigAgentDef["sandbox"]; model?: string; maxIterations?: number; copyToWorktree?: string[] }
export interface ConfigPipelineDef { description?: string; branchStrategy?: Record<string, unknown>; sandbox?: ConfigAgentDef["sandbox"]; model?: string; copyToWorktree?: string[]; steps: ConfigPipelineStep[] }

export interface ConfigShadowSnapshot {
	defaultSandbox?: ConfigAgentDef["sandbox"];
	defaultModel?: string;
	defaultPipeline?: string;
	defaultAgent?: string;
	issueTracker?: string;
	issueTrackerSetupCommand?: string;
	imageNamePattern?: string;
	agents: Record<string, ConfigAgentDef>;
	chains: Record<string, ConfigChainStep[]>;
	pipelines: Record<string, ConfigPipelineDef>;
}

export type ConfigShadowChange = ShadowChange<ConfigShadowSnapshot>;

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
		}
		this.emit("set-config", `Set ${path}`, before, { path, value });
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
		for (const pipeline of Object.values(this.state.pipelines)) for (const step of pipeline.steps || []) if (step.role === oldName) step.role = newName;
		this.emit("rename-agent", `Rename role ${oldName} → ${newName}`, before, { oldName, newName });
	}

	deleteAgent(name: string): void {
		const before = this.capture();
		delete this.state.agents[name];
		this.emit("delete-agent", `Delete role ${name}`, before, { name });
	}


	addPipeline(name: string): void {
		const before = this.capture();
		this.state.pipelines[name] = { description: `${name} pipeline`, steps: [{ role: "worker", prompt: "Complete the requested task." }] };
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
