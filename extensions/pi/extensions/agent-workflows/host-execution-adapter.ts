import {
	claudeCode,
	codex,
	copilot,
	cursor,
	opencode,
	pi as piAgent,
	run as sandcastleRun,
	type RunOptions,
} from "@ai-hero/sandcastle";
import { createWorktree } from "../../node_modules/@ai-hero/sandcastle/dist/index.js";

type AgentProviderName = "claude" | "claude-code" | "pi" | "codex" | "cursor" | "opencode" | "copilot" | string | undefined;
type SandboxName = "docker" | "podman" | "vercel" | "no-sandbox" | string | undefined;

export type PipelineBranchStrategy = NonNullable<RunOptions["branchStrategy"]>;

export interface PipelineHostExecutionAdapter {
	createWorktree: typeof createWorktree;
	loadSandboxProvider: (kind: SandboxName, options?: Record<string, unknown>) => Promise<any>;
	makeAgent: (model: string, provider?: AgentProviderName, options?: Record<string, unknown>) => any;
	run: typeof sandcastleRun;
}

export interface PipelineHostExecutionAdapterOverrides {
	createWorktree?: PipelineHostExecutionAdapter["createWorktree"];
	loadSandboxProvider?: PipelineHostExecutionAdapter["loadSandboxProvider"];
	makeAgent?: PipelineHostExecutionAdapter["makeAgent"];
	run?: PipelineHostExecutionAdapter["run"];
}

function withSandboxRuntimeOptions(kind: SandboxName, options?: Record<string, unknown>): Record<string, unknown> | undefined {
	if (kind !== "podman") return options;
	return { ...(options || {}), runtime: "podman" };
}

function withPodmanCreateCleanup<T extends Record<string, any>>(provider: T, kind: SandboxName): T {
	if (kind !== "podman" || typeof provider?.create !== "function") return provider;
	return {
		...provider,
		async create(...args: unknown[]) {
			try {
				return await provider.create(...args);
			} catch (error) {
				throw error;
			}
		},
	};
}

export async function loadSandcastleSandboxProvider(kind: SandboxName, options?: Record<string, unknown>): Promise<any> {
	const runtimeOptions = withSandboxRuntimeOptions(kind, options);
	if (kind === "podman") return withPodmanCreateCleanup((await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/podman.js")).podman(runtimeOptions as any), kind);
	if (kind === "vercel") return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/vercel.js")).vercel();
	if (kind === "no-sandbox") return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/no-sandbox.js")).noSandbox();
	return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/docker.js")).docker(runtimeOptions as any);
}

export function makeSandcastleAgent(model: string, provider?: AgentProviderName): any {
	if (provider === "claude" || provider === "claude-code") return claudeCode(model);
	if (provider === "codex") return codex(model);
	if (provider === "cursor") return cursor(model);
	if (provider === "opencode") return opencode(model);
	if (provider === "copilot") return copilot(model);
	return piAgent(model, { captureSessions: false } as any);
}

export function createSandcastleHostExecutionAdapter(overrides: PipelineHostExecutionAdapterOverrides = {}): PipelineHostExecutionAdapter {
	return {
		createWorktree: overrides.createWorktree || createWorktree,
		loadSandboxProvider: overrides.loadSandboxProvider || loadSandcastleSandboxProvider,
		makeAgent: overrides.makeAgent || makeSandcastleAgent,
		run: overrides.run || sandcastleRun,
	};
}
