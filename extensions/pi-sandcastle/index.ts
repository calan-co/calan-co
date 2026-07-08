// Pi Sandcastle extension: Pi-native delegation UI backed by Sandcastle sandboxes.
// Commands: /sc:* and /backlog:* command surfaces for Sandcastle-backed work.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	claudeCode,
	run as sandcastleRun,
	type RunOptions,
	type RunResult,
	type SandboxProvider,
} from "@ai-hero/sandcastle";
import {
	createWorktree,
	type WorktreeBranchStrategy,
} from "../../node_modules/@ai-hero/sandcastle/dist/index.js";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { vercel } from "@ai-hero/sandcastle/sandboxes/vercel";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { registerRunManagementCommands } from "./run-management.mjs";
import { registerBacklogCommands } from "./backlog.mjs";
import { buildBacklogPlan, formatBacklogPlan } from "./backlog-planner.mjs";
import {
	formatBacklogRunList,
	formatStatusSelection,
	listBacklogRuns,
	resumeBacklogRun,
	selectBacklogRunForStatus,
} from "./backlog-runs.mjs";

const ToolType = {
	Object(schema: Record<string, unknown>) {
		return schema;
	},
};

interface AgentDef {
	name: string;
	description?: string;
	model?: string;
	sandbox?: "docker" | "podman" | "vercel" | "no-sandbox";
	systemPrompt?: string;
	maxIterations?: number;
	branch?: string;
	copyToWorktree?: string[];
}

type SandcastleSandbox = NonNullable<AgentDef["sandbox"]>;

interface ChainStep {
	agent: string;
	prompt: string;
}

interface PipelineStep {
	agent: string;
	prompt: string;
	sandbox?: AgentDef["sandbox"];
	model?: string;
	maxIterations?: number;
	copyToWorktree?: string[];
}

interface PipelineBranchStrategyConfig {
	type?: "branch" | "merge-to-head";
	branch?: string;
	baseBranch?: string;
}

interface PipelineDef {
	description?: string;
	branchStrategy?: PipelineBranchStrategyConfig;
	sandbox?: AgentDef["sandbox"];
	model?: string;
	copyToWorktree?: string[];
	steps: PipelineStep[];
}

type PipelineBranchStrategy = WorktreeBranchStrategy;

interface SandcastleConfig {
	defaultTeam?: string;
	defaultSandbox?: AgentDef["sandbox"];
	defaultModel?: string;
	agents: Record<string, AgentDef>;
	teams: Record<string, string[]>;
	chains: Record<string, ChainStep[]>;
	pipelines: Record<string, PipelineDef>;
}

type SandcastleProcess = ReturnType<typeof spawn>;
interface BacklogItem {
	id: string;
	title: string;
	summary?: string;
	tags: string[];
	sourcePath: string;
}

interface BacklogPlanIteration {
	items: BacklogItem[];
	recommendedPipeline: string;
	supportsParallel: boolean;
	rationale: string;
}

interface BacklogPlanResult {
	query: string;
	iterations: BacklogPlanIteration[];
}

interface BacklogProcessRecord {
	id: string;
	query: string;
	resolvedItems: BacklogItem[];
	pipeline: string;
	status: "queued" | "running" | "done" | "error";
	branches: string[];
	logs: string[];
	startedAt: number;
	updatedAt: number;
	endedAt?: number;
}

type BacklogProcessStatus = BacklogProcessRecord["status"];

interface BacklogExecutionResult {
	branches: string[];
	logs: string[];
	status: BacklogProcessStatus;
}

interface BacklogItemDispatchResult {
	branch?: string;
	logPath?: string;
	status: BacklogProcessStatus;
}

interface BacklogProcessPlanDeps {
	plan?: (cwd: string, query: string) => Promise<BacklogPlanResult>;
	execute?: (
		cwd: string,
		input: {
			runId: string;
			query: string;
			pipeline: string;
			items: BacklogItem[];
			parallel: boolean;
			recordPath: string;
		},
	) => Promise<{ branches?: string[]; logs?: string[]; status?: BacklogProcessRecord["status"] }>;
	now?: () => number;
}

interface PiSandcastleDependencies {
	backlog?: BacklogProcessPlanDeps;
	pipeline?: PipelineExecutionDeps;
	sandcastle?: SandcastleRunCapability;
	now?: () => number;
	randomId?: () => string;
}

interface RunState {
	id: string;
	agent: string;
	task: string;
	status: "running" | "done" | "error" | "cancelled";
	startedAt: number;
	lastLine: string;
	logPath?: string;
	resultPath?: string;
	branch?: string;
	commits?: string[];
	proc?: SandcastleProcess;
}

type RootConfigKey = "defaultTeam" | "defaultSandbox" | "defaultModel";
type EditableAgentField = "description" | "model" | "sandbox" | "maxIterations" | "branch";

const CONFIG_DIR = ".pi/sandcastle";
const CONFIG_PATH = `${CONFIG_DIR}/agents.yaml`;
const RUNNER_PATH = `${CONFIG_DIR}/run-job.mjs`;
const JOBS_DIR = `${CONFIG_DIR}/jobs`;
const RESULTS_DIR = `${CONFIG_DIR}/results`;
const SUPPORTED_SANDBOXES = new Set(["docker", "podman", "vercel", "no-sandbox"]);
const DEFAULT_TEAM = "default";
const DEFAULT_SANDBOX: NonNullable<AgentDef["sandbox"]> = "docker";
const DEFAULT_MODEL = "claude-opus-4-8";
const ROOT_CONFIG_KEYS: RootConfigKey[] = ["defaultTeam", "defaultSandbox", "defaultModel"];
const EDITABLE_AGENT_FIELDS: EditableAgentField[] = ["description", "model", "sandbox", "maxIterations", "branch"];
const RUNS_DIR = `${CONFIG_DIR}/runs`;
const LOGS_DIR = `${CONFIG_DIR}/logs`;
const DEFAULT_STEP_PROMPT = "$INPUT";
const PIPELINE_RUNS_DIR = RUNS_DIR;
const BACKLOG_RUNS_DIR = `${CONFIG_DIR}/backlog-runs`;

const SAMPLE_CONFIG = `# Pi Sandcastle delegation config.
# Install runtime once with: npm install --save-dev @ai-hero/sandcastle
# Optional first-time Sandcastle setup: npx @ai-hero/sandcastle init

defaultTeam: default
defaultSandbox: docker
defaultModel: claude-opus-4-8

agents:
  researcher:
    description: Read-only scout for codebase reconnaissance.
    model: claude-opus-4-8
    sandbox: docker
    maxIterations: 1
    systemPrompt: |
      You are a research subagent. Inspect the repository and report concise,
      evidence-backed findings. Do not modify files. End with <promise>COMPLETE</promise>.
  builder:
    description: Implementation agent that may change files in its sandbox branch.
    model: claude-opus-4-8
    sandbox: docker
    maxIterations: 5
    systemPrompt: |
      You are an implementation subagent. Make focused changes, run relevant checks,
      and commit useful work. End with <promise>COMPLETE</promise>.
  reviewer:
    description: Reviewer for diffs, tests, and merge risks.
    model: claude-opus-4-8
    sandbox: docker
    maxIterations: 1
    systemPrompt: |
      You are a review subagent. Audit the proposed solution for correctness,
      risks, missing tests, and merge blockers. End with <promise>COMPLETE</promise>.

teams:
  default: [researcher, builder, reviewer]
  research: [researcher, reviewer]

chains:
  explore-plan-review:
    - agent: researcher
      prompt: |
        Investigate this task and list relevant files, constraints, and likely implementation paths:\n\n$INPUT
    - agent: builder
      prompt: |
        Use the research below to implement the task.\n\nOriginal task:\n$ORIGINAL\n\nResearch:\n$INPUT
    - agent: reviewer
      prompt: |
        Review the implementation result below.\n\nOriginal task:\n$ORIGINAL\n\nImplementation summary:\n$INPUT

pipelines:
  implement:
    description: Fixed-domain implementation pipeline.
    branchStrategy:
      type: branch
      branch: sandcastle/implement
    sandbox: docker
    model: claude-opus-4-8
    steps:
      - agent: researcher
        prompt: |
          Inspect the requested work and identify relevant files, constraints, and risks.\n\n$INPUT
        maxIterations: 1
      - agent: builder
        prompt: |
          Implement the requested work using the research below.\n\nOriginal request:\n$ORIGINAL\n\nResearch and prompt:\n$INPUT
        maxIterations: 5
      - agent: reviewer
        prompt: |
          Review the implementation and call out correctness risks or missing tests.\n\nOriginal request:\n$ORIGINAL\n\nImplementation summary:\n$INPUT
        maxIterations: 1

  repair:
    description: Fixed-domain repair pipeline.
    branchStrategy:
      type: branch
      branch: sandcastle/repair
    sandbox: docker
    model: claude-opus-4-8
    steps:
      - agent: reviewer
        prompt: |
          Inspect the reported failure and identify the smallest safe repair path.\n\n$INPUT
        maxIterations: 1
      - agent: builder
        prompt: |
          Apply the repair and keep the diff minimal.\n\nOriginal request:\n$ORIGINAL\n\nRepair analysis:\n$INPUT
        maxIterations: 3
`;

interface ScRunRecord {
	id: string;
	agent: string;
	prompt: string;
	promptSummary: string;
	status: "started" | "running" | "completed" | "failed";
	createdAt: number;
	updatedAt: number;
	startedAt?: number;
	finishedAt?: number;
	branch?: string;
	commits?: string[];
	logPath?: string;
	error?: string;
}

interface SandcastleRunCapability {
	makeAgent: (model: string) => RunOptions["agent"];
	makeSandbox: (kind: SandcastleSandbox) => SandboxProvider;
	run: (options: RunOptions) => Promise<RunResult>;
}

interface SandcastleRunDeps {
	sandcastle?: SandcastleRunCapability;
	now?: () => number;
	randomId?: () => string;
}

interface AgentRuntimeSettings {
	model: string;
	sandbox: SandcastleSandbox;
}

interface ScRunSettings extends AgentRuntimeSettings {
	logPath: string;
	branchStrategy: RunOptions["branchStrategy"];
}

function resolveSandboxProvider(kind: SandcastleSandbox): SandboxProvider {
	switch (kind) {
		case "podman":
			return podman();
		case "vercel":
			return vercel();
		case "no-sandbox":
			return noSandbox();
		default:
			return docker();
	}
}

const createDefaultSandcastleRunCapability = (): SandcastleRunCapability => ({
	makeAgent: (model) => claudeCode(model),
	makeSandbox: (kind) => resolveSandboxProvider(kind),
	run: sandcastleRun,
});

const RUNNER = `#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const jobPath = process.argv[2];
if (!jobPath) throw new Error("Usage: node run-job.mjs <job.json>");
const job = JSON.parse(readFileSync(jobPath, "utf8"));

function emit(event) {
  console.log(JSON.stringify({ source: "pi-sandcastle", ...event }));
}

const userNodeModules = process.env.PI_AGENT_NODE_MODULES || join(process.env.HOME || "", ".pi", "agent", "npm", "node_modules");
const importUserPackage = (subpath) => import(pathToFileURL(join(userNodeModules, "@ai-hero", "sandcastle", subpath)).href);

async function loadSandbox(kind) {
  if (kind === "podman") return (await importUserPackage("dist/sandboxes/podman.js")).podman();
  if (kind === "vercel") return (await importUserPackage("dist/sandboxes/vercel.js")).vercel();
  if (kind === "no-sandbox") return (await importUserPackage("dist/sandboxes/no-sandbox.js")).noSandbox();
  return (await importUserPackage("dist/sandboxes/docker.js")).docker();
}

try {
  const { run, claudeCode } = await importUserPackage("dist/index.js");
  const sandbox = await loadSandbox(job.sandbox || "docker");
  const prompt = (job.systemPrompt ? job.systemPrompt + "\n\n" : "") + "## Delegated task\n\n" + job.prompt;
  const logPath = job.logPath;
  const resultPath = job.resultPath;
  mkdirSync(dirname(logPath), { recursive: true });
  mkdirSync(dirname(resultPath), { recursive: true });

  emit({ type: "start", id: job.id, agent: job.agent, sandbox: job.sandbox, model: job.model });
  const result = await run({
    name: job.name || job.id,
    cwd: job.cwd,
    agent: claudeCode(job.model),
    sandbox,
    prompt,
    maxIterations: job.maxIterations || 1,
    branchStrategy: job.branch ? { type: "branch", branch: job.branch } : undefined,
    copyToWorktree: job.copyToWorktree,
    logging: {
      type: "file",
      path: logPath,
      verbose: true,
      onAgentStreamEvent: (event) => {
        if (event.type === "text") emit({ type: "text", id: job.id, text: event.text || event.chunk || "" });
        else if (event.type === "toolCall") emit({ type: "tool", id: job.id, tool: event.name || event.toolName || "tool" });
        else if (event.type === "raw") emit({ type: "raw", id: job.id, text: event.text || event.line || "" });
      },
    },
  });

  const payload = {
    id: job.id,
    agent: job.agent,
    branch: result.branch,
    commits: (result.commits || []).map((c) => c.sha || c),
    iterations: result.iterations || [],
    logPath,
  };
  writeFileSync(resultPath, JSON.stringify(payload, null, 2));
  emit({ type: "done", id: job.id, branch: payload.branch, commits: payload.commits, resultPath });
} catch (error) {
  const message = error && error.stack ? error.stack : String(error);
  if (job?.resultPath) writeFileSync(job.resultPath, JSON.stringify({ id: job.id, agent: job.agent, error: message }, null, 2));
  emit({ type: "error", id: job?.id, error: message });
  process.exitCode = 1;
}
`;

function tokenizeCommandArgs(raw: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: string | null = null;
	let escaped = false;

	for (const char of raw.trim()) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}

	if (escaped) current += "\\";
	if (current) tokens.push(current);
	return tokens;
}

export function parseBacklogProcessArgs(raw: string): { query: string; pipeline?: string } {
	const tokens = tokenizeCommandArgs(raw);
	const queryTokens: string[] = [];
	let pipeline: string | undefined;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token === "--pipeline" || token === "-p") {
			const value = tokens[i + 1];
			if (!value || value.startsWith("-")) {
				throw new Error(`Missing value for ${token}. Use /backlog:process <query> --pipeline <pipeline>.`);
			}
			pipeline = value;
			i++;
			continue;
		}
		if (token.startsWith("--pipeline=")) {
			pipeline = token.slice("--pipeline=".length);
			if (!pipeline) {
				throw new Error("Missing value for --pipeline. Use /backlog:process <query> --pipeline <pipeline>.");
			}
			continue;
		}
		if (token.startsWith("-p=")) {
			pipeline = token.slice(3);
			if (!pipeline) {
				throw new Error("Missing value for -p. Use /backlog:process <query> -p <pipeline>.");
			}
			continue;
		}
		queryTokens.push(token);
	}

	return { query: queryTokens.join(" ").trim(), pipeline };
}

function ensureBacklogRunScaffold(cwd: string): void {
	mkdirSync(join(cwd, BACKLOG_RUNS_DIR), { recursive: true });
}

function getBacklogRunRecordPath(cwd: string, runId: string): string {
	return join(cwd, BACKLOG_RUNS_DIR, `${runId}.json`);
}

function writeBacklogRunRecord(cwd: string, record: BacklogProcessRecord): string {
	ensureBacklogRunScaffold(cwd);
	const recordPath = getBacklogRunRecordPath(cwd, record.id);
	writeFileSync(recordPath, JSON.stringify(record, null, 2));
	return recordPath;
}

function getBacklogTimestamp(now?: () => number): number {
	return now?.() ?? Date.now();
}

function createBacklogRunId(startedAt: number): string {
	return `backlog-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readFrontmatter(text: string): Record<string, string> {
	const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return {};
	const frontmatter: Record<string, string> = {};
	let currentKey = "";
	for (const line of match[1]!.split("\n")) {
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (keyValue) {
			currentKey = keyValue[1]!;
			frontmatter[currentKey] = keyValue[2]!;
			continue;
		}
		if (currentKey && line.startsWith("  ")) {
			frontmatter[currentKey] = `${frontmatter[currentKey]}\n${line.trim()}`;
		}
	}
	return frontmatter;
}

function parseFrontmatterList(raw: string | undefined): string[] {
	if (!raw) return [];
	const value = raw.trim();
	if (!value) return [];
	if (value.startsWith("[") && value.endsWith("]")) {
		return value
			.slice(1, -1)
			.split(",")
			.map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
			.filter(Boolean);
	}
	return value
		.split("\n")
		.map((part) => part.replace(/^-+\s*/, "").trim())
		.filter(Boolean);
}

function readBacklogItems(cwd: string): BacklogItem[] {
	const backlogDir = join(cwd, "backlog");
	if (!existsSync(backlogDir)) return [];
	return readdirSync(backlogDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => {
			const sourcePath = join(backlogDir, entry.name);
			const text = readFileSync(sourcePath, "utf8");
			const frontmatter = readFrontmatter(text);
			const title = frontmatter.title || entry.name.replace(/^\d+-/, "").replace(/\.md$/, "");
			const summary = frontmatter.summary || undefined;
			const tags = parseFrontmatterList(frontmatter.tags);
			const id = frontmatter.id || entry.name.slice(0, 5);
			return { id, title, summary, tags, sourcePath };
		})
		.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
}

function matchesBacklogQuery(item: BacklogItem, query: string): boolean {
	const raw = query.trim().toLowerCase();
	if (!raw) return true;
	const haystack = [item.id, item.title, item.summary || "", item.sourcePath, ...item.tags].join(" ").toLowerCase();
	const tokens = raw.split(/\s+/).filter(Boolean);
	return tokens.every((token) => haystack.includes(token));
}

function inferRecommendedPipeline(query: string, items: BacklogItem[]): string {
	const haystack = `${query} ${items
		.map((item) => `${item.id} ${item.title} ${item.summary || ""} ${item.tags.join(" ")}`)
		.join(" ")}`.toLowerCase();
	if (/\b(review|audit|verify|qa)\b/.test(haystack)) return "review";
	if (/\b(fix|repair|bug|bugs|issue|error)\b/.test(haystack)) return "fix";
	if (/\b(research|inspect|investigate|discover)\b/.test(haystack)) return "research";
	return "implement";
}

async function defaultPlanBacklogProcessing(cwd: string, query: string): Promise<BacklogPlanResult> {
	const allItems = readBacklogItems(cwd);
	const matchingItems = allItems.filter((item) => matchesBacklogQuery(item, query));
	const fallbackItems = allItems.slice(0, 1);
	const items = matchingItems.length > 0 ? matchingItems : fallbackItems;
	const rationale = items.length > 1
		? "The first recommended iteration contains independent backlog items that can run in parallel."
		: "The first recommended iteration focuses on the best matching backlog item.";
	return {
		query,
		iterations: [
			{
				items,
				recommendedPipeline: inferRecommendedPipeline(query, items),
				supportsParallel: items.length > 1,
				rationale,
			},
		],
	};
}

function ensureScaffold(cwd: string): void {
	mkdirSync(join(cwd, CONFIG_DIR), { recursive: true });
	mkdirSync(join(cwd, JOBS_DIR), { recursive: true });
	mkdirSync(join(cwd, RESULTS_DIR), { recursive: true });
	mkdirSync(join(cwd, PIPELINE_RUNS_DIR), { recursive: true });
	const configPath = join(cwd, CONFIG_PATH);
	if (!existsSync(configPath)) writeFileSync(configPath, SAMPLE_CONFIG);
	const runnerPath = join(cwd, RUNNER_PATH);
	if (!existsSync(runnerPath)) writeFileSync(runnerPath, RUNNER);
}

function ensureScaffoldPath(cwd: string): string {
	ensureScaffold(cwd);
	return join(cwd, CONFIG_PATH);
}

function readConfigText(cwd: string): string {
	const configPath = ensureScaffoldPath(cwd);
	return readFileSync(configPath, "utf8");
}

function readExistingConfigText(cwd: string): string {
	const configPath = join(cwd, CONFIG_PATH);
	return readFileSync(configPath, "utf8");
}

function writeConfigText(cwd: string, text: string): void {
	ensureScaffold(cwd);
	writeFileSync(join(cwd, CONFIG_PATH), text);
}

function splitConfigPath(path: string): string[] {
	return path.split(".").map((part) => part.trim()).filter(Boolean);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRootConfigKey(value: string): value is RootConfigKey {
	return ROOT_CONFIG_KEYS.includes(value as RootConfigKey);
}

function isEditableAgentField(value: string): value is EditableAgentField {
	return EDITABLE_AGENT_FIELDS.includes(value as EditableAgentField);
}

function formatScalarForYaml(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => formatScalarForYaml(item)).join(", ")}]`;
	}
	if (value === null || value === undefined) return "";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	const text = String(value);
	if (text.includes("\n")) {
		return `|\n${text
			.split("\n")
			.map((line) => `      ${line}`)
			.join("\n")}`;
	}
	if (/[:#\[\],{}]|^\s|\s$/.test(text)) return JSON.stringify(text);
	return text;
}

function formatConfigValue(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

function readConfigValue(cfg: SandcastleConfig, path: string): unknown {
	const parts = splitConfigPath(path);
	if (parts.length === 1 && isRootConfigKey(parts[0])) return cfg[parts[0]];
	if (parts[0] === "agents" && parts.length === 3 && isEditableAgentField(parts[2])) {
		return cfg.agents[parts[1]]?.[parts[2]];
	}
	if (parts[0] === "teams" && parts.length === 2) return cfg.teams[parts[1]];
	if (parts[0] === "chains" && parts.length === 2) return cfg.chains[parts[1]];
	return undefined;
}

function supportedConfigPath(path: string): boolean {
	const parts = splitConfigPath(path);
	if (parts.length === 1) return isRootConfigKey(parts[0]);
	return parts[0] === "agents" && parts.length === 3 && isEditableAgentField(parts[2]);
}

function defaultConfigValue(path: string): unknown {
	const parts = splitConfigPath(path);
	if (parts.length === 1 && isRootConfigKey(parts[0])) {
		return DEFAULT_CONFIG[parts[0]];
	}
	if (parts[0] === "agents" && parts.length === 3 && isEditableAgentField(parts[2])) {
		return DEFAULT_CONFIG.agents[parts[1]]?.[parts[2]];
	}
	return undefined;
}

function setConfigValueInText(raw: string, path: string, value: unknown): string {
	const parts = splitConfigPath(path);
	const lines = raw.replace(/\r/g, "").split("\n");

	if (parts.length === 1) {
		const key = parts[0];
		const replacement = `${key}: ${formatScalarForYaml(value)}`;
		for (let i = 0; i < lines.length; i++) {
			if (new RegExp(`^${escapeRegExp(key)}:\\s*`).test(lines[i])) {
				lines[i] = replacement;
				return lines.join("\n");
			}
			if (/^(agents|teams|chains):\s*$/.test(lines[i])) {
				lines.splice(i, 0, replacement);
				return lines.join("\n");
			}
		}
		lines.push(replacement);
		return lines.join("\n");
	}

	if (parts[0] === "agents" && parts.length === 3) {
		const [, agentName, fieldName] = parts;
		const agentHeader = new RegExp(`^  ${escapeRegExp(agentName)}:\\s*$`);
		let agentIndex = -1;
		for (let i = 0; i < lines.length; i++) {
			if (agentHeader.test(lines[i])) {
				agentIndex = i;
				break;
			}
		}
		if (agentIndex === -1) throw new Error(`Unknown agent '${agentName}'.`);
		const fieldLine = `${fieldName}: ${formatScalarForYaml(value)}`;
		for (let i = agentIndex + 1; i < lines.length; i++) {
			const line = lines[i];
			const indent = line.match(/^\s*/)?.[0].length ?? 0;
			const trimmed = line.trim();
			if (trimmed && indent <= 2) {
				lines.splice(i, 0, `    ${fieldLine}`);
				return lines.join("\n");
			}
			if (new RegExp(`^\\s{4}${fieldName}:\\s*`).test(line)) {
				lines[i] = `    ${fieldLine}`;
				return lines.join("\n");
			}
		}
		lines.push(`    ${fieldLine}`);
		return lines.join("\n");
	}

	throw new Error(`Unsupported config path '${path}'.`);
}

function resetConfigText(raw: string, path?: string): string {
	if (!path) {
		let updated = raw;
		for (const name of ROOT_CONFIG_KEYS) {
			updated = setConfigValueInText(updated, name, defaultConfigValue(name));
		}
		return updated;
	}
	return setConfigValueInText(raw, path, defaultConfigValue(path));
}

function validateConfig(cwd: string, cfg: SandcastleConfig): string[] {
	const issues: string[] = [];
	const configPath = join(cwd, CONFIG_PATH);
	const runnerPath = join(cwd, RUNNER_PATH);
	if (!existsSync(configPath)) issues.push(`Missing config scaffold: ${CONFIG_PATH}`);
	if (!existsSync(runnerPath)) issues.push(`Missing runner scaffold: ${RUNNER_PATH}`);
	if (!Object.keys(cfg.agents).length) issues.push("No agents configured.");
	for (const [name, agent] of Object.entries(cfg.agents)) {
		if (!agent.description) issues.push(`Agent '${name}' is missing a description.`);
		if (!agent.model) issues.push(`Agent '${name}' is missing a model reference.`);
		if (agent.model && /[\s]/.test(agent.model)) issues.push(`Agent '${name}' has an invalid model reference '${agent.model}'.`);
		if (agent.sandbox && !SUPPORTED_SANDBOXES.has(agent.sandbox)) {
			issues.push(`Agent '${name}' uses unsupported sandbox provider '${agent.sandbox}'.`);
		}
		if (agent.maxIterations !== undefined && (!Number.isInteger(agent.maxIterations) || agent.maxIterations < 1)) {
			issues.push(`Agent '${name}' has an invalid maxIterations value.`);
		}
		if (agent.systemPrompt && !agent.systemPrompt.trim()) issues.push(`Agent '${name}' has an empty system prompt.`);
	}
	for (const [teamName, members] of Object.entries(cfg.teams)) {
		if (!Array.isArray(members) || !members.length) {
			issues.push(`Team '${teamName}' has no members.`);
			continue;
		}
		for (const member of members) {
			if (!cfg.agents[member]) issues.push(`Team '${teamName}' references unknown agent '${member}'.`);
		}
	}
	for (const [chainName, steps] of Object.entries(cfg.chains)) {
		if (!Array.isArray(steps) || !steps.length) {
			issues.push(`Chain '${chainName}' has no steps.`);
			continue;
		}
		for (const step of steps) {
			if (!cfg.agents[step.agent]) issues.push(`Chain '${chainName}' references unknown agent '${step.agent}'.`);
			if (!step.prompt || !step.prompt.trim()) issues.push(`Chain '${chainName}' has an empty prompt step.`);
		}
	}
	if (cfg.defaultSandbox && !SUPPORTED_SANDBOXES.has(cfg.defaultSandbox)) {
		issues.push(`Default sandbox provider '${cfg.defaultSandbox}' is unsupported.`);
	}
	if (cfg.defaultModel && /[\s]/.test(cfg.defaultModel)) {
		issues.push(`Default model reference '${cfg.defaultModel}' is invalid.`);
	}
	return issues;
}

function normalizeConfig(cfg: Partial<SandcastleConfig>): SandcastleConfig {
	return {
		defaultTeam: cfg.defaultTeam ?? DEFAULT_TEAM,
		defaultSandbox: cfg.defaultSandbox ?? DEFAULT_SANDBOX,
		defaultModel: cfg.defaultModel ?? DEFAULT_MODEL,
		agents: cfg.agents || {},
		teams: cfg.teams || {},
		chains: cfg.chains || {},
		pipelines: cfg.pipelines || {},
	};
}

const DEFAULT_CONFIG = normalizeConfig(parseSimpleYaml(SAMPLE_CONFIG));

function parseScalar(raw: string): any {
	const value = raw.trim();
	if (!value) return "";
	if (value === "true") return true;
	if (value === "false") return false;
	if (/^\d+$/.test(value)) return Number(value);
	if (value.startsWith("[") && value.endsWith("]")) {
		return value.slice(1, -1).split(",").map((part) => part.trim().replace(/^['\"]|['\"]$/g, "")).filter(Boolean);
	}
	return value.replace(/^['\"]|['\"]$/g, "");
}

interface YamlBlockTarget {
	indent: number;
	text: string[];
	set: (text: string) => void;
}

function assignBlockOrScalar(
	raw: string,
	indent: number,
	assign: (value: YamlScalar) => void,
): YamlBlockTarget | null {
	if (raw === "|") {
		return { indent, text: [], set: assign };
	}
	assign(parseScalar(raw));
	return null;
}

function setField<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
	target[key] = value;
}

export function parseSimpleYaml(raw: string): SandcastleConfig {
	const cfg: SandcastleConfig = { agents: {}, teams: {}, chains: {}, pipelines: {} };
	const lines = raw.replace(/\r/g, "").split("\n");
	let section = "";
	let currentAgent = "";
	let currentChain = "";
	let currentPipeline = "";
	let currentPipelineStep: PipelineStep | null = null;
	let currentStep: ChainStep | null = null;
	let currentBranchStrategy: PipelineBranchStrategyConfig | null = null;
	let blockTarget: YamlBlockTarget | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (blockTarget) {
			const indent = line.match(/^\s*/)?.[0].length ?? 0;
			if (line.trim() === "" || indent > blockTarget.indent) {
				blockTarget.text.push(line.slice(Math.min(indent, blockTarget.indent + 2)));
				continue;
			}
			blockTarget.set(blockTarget.text.join("\n").trimEnd());
			blockTarget = null;
			i--;
			continue;
		}
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const top = trimmed.match(/^(defaultTeam|defaultSandbox|defaultModel):\s*(.*)$/);
		if (top) {
			const key = top[1] as "defaultTeam" | "defaultSandbox" | "defaultModel";
			setField(cfg, key, parseScalar(top[2]) as SandcastleConfig[typeof key]);
			continue;
		}
		const sectionMatch = line.match(/^(agents|teams|chains|pipelines):\s*$/);
		if (sectionMatch) {
			section = sectionMatch[1];
			currentAgent = "";
			currentChain = "";
			currentPipeline = "";
			currentPipelineStep = null;
			currentBranchStrategy = null;
			continue;
		}
		if (section === "agents") {
			const agentMatch = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*$/);
			if (agentMatch) {
				currentAgent = agentMatch[1];
				cfg.agents[currentAgent] = { name: currentAgent };
				continue;
			}
			const field = line.match(/^\s{4}([A-Za-z0-9_-]+):\s*(.*)$/);
			if (field && currentAgent) {
				const agent = cfg.agents[currentAgent];
				const key = field[1] as keyof AgentDef;
				blockTarget = assignBlockOrScalar(field[2], 4, (value) => {
					setField(agent, key, value as AgentDef[typeof key]);
				});
			}
			continue;
		}
		if (section === "teams") {
			const team = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*(.*)$/);
			if (team) cfg.teams[team[1]] = parseScalar(team[2]);
			continue;
		}
		if (section === "chains") {
			const chain = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*$/);
			if (chain) {
				currentChain = chain[1];
				cfg.chains[currentChain] = [];
				continue;
			}
			const step = line.match(/^\s{4}-\s+agent:\s*(.+)$/);
			if (step && currentChain) {
				currentStep = { agent: parseScalar(step[1]), prompt: DEFAULT_STEP_PROMPT };
				cfg.chains[currentChain].push(currentStep);
				continue;
			}
			const prompt = line.match(/^\s{6}prompt:\s*(.*)$/);
			if (prompt && currentStep) {
				blockTarget = assignBlockOrScalar(prompt[1], 6, (value) => {
					currentStep!.prompt = value;
				});
			}
			continue;
		}
		if (section === "pipelines") {
			const pipeline = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*$/);
			if (pipeline) {
				currentPipeline = pipeline[1];
				cfg.pipelines[currentPipeline] = { steps: [] };
				currentPipelineStep = null;
				currentBranchStrategy = null;
				continue;
			}
			if (!currentPipeline) continue;
			const pipelineField = line.match(/^\s{4}([A-Za-z0-9_-]+):\s*(.*)$/);
			if (pipelineField && pipelineField[1] !== "steps" && pipelineField[1] !== "branchStrategy") {
				const activePipeline = cfg.pipelines[currentPipeline];
				const key = pipelineField[1] as keyof PipelineDef;
				blockTarget = assignBlockOrScalar(pipelineField[2], 4, (value) => {
					setField(activePipeline, key, value as PipelineDef[typeof key]);
				});
				continue;
			}
			if (/^\s{4}branchStrategy:\s*$/.test(line)) {
				currentBranchStrategy = cfg.pipelines[currentPipeline].branchStrategy ||= {};
				continue;
			}
			if (currentBranchStrategy) {
				const branchField = line.match(/^\s{6}([A-Za-z0-9_-]+):\s*(.*)$/);
				if (branchField) {
					const key = branchField[1] as keyof PipelineBranchStrategyConfig;
					setField(currentBranchStrategy, key, parseScalar(branchField[2]) as PipelineBranchStrategyConfig[typeof key]);
					continue;
				}
			}
			const step = line.match(/^\s{6}-\s+agent:\s*(.+)$/);
			if (step) {
				currentPipelineStep = { agent: parseScalar(step[1]), prompt: DEFAULT_STEP_PROMPT };
				cfg.pipelines[currentPipeline].steps.push(currentPipelineStep);
				continue;
			}
			const pipelineStepField = line.match(/^\s{8}([A-Za-z0-9_-]+):\s*(.*)$/);
			if (pipelineStepField && currentPipelineStep) {
				const key = pipelineStepField[1] as keyof PipelineStep;
				blockTarget = assignBlockOrScalar(pipelineStepField[2], 8, (value) => {
					setField(currentPipelineStep, key, value as PipelineStep[typeof key]);
				});
			}
		}
	}
	if (blockTarget) blockTarget.set(blockTarget.text.join("\n").trimEnd());
	return cfg;
}

async function loadConfig(cwd: string): Promise<SandcastleConfig> {
	const raw = readConfigText(cwd);
	return normalizeConfig(parseSimpleYaml(raw));
}

async function loadExistingConfig(cwd: string): Promise<SandcastleConfig> {
	const raw = readExistingConfigText(cwd);
	return normalizeConfig(parseSimpleYaml(raw));
}

function resolveDefaultRunAgentName(cfg: SandcastleConfig): string | undefined {
	const preferredTeam = cfg.defaultTeam ? cfg.teams[cfg.defaultTeam] : undefined;
	if (preferredTeam) {
		for (const agent of preferredTeam) {
			if (cfg.agents[agent]) return agent;
		}
	}
	return Object.keys(cfg.agents)[0];
}

function resolveRunInvocation(args: string, cfg: SandcastleConfig): { agentName: string | undefined; prompt: string } {
	const raw = args.trim();
	if (!raw) return { agentName: resolveDefaultRunAgentName(cfg), prompt: "" };

	const match = raw.match(/^(\S+)(?:\s+([\s\S]*))?$/);
	if (!match) return { agentName: resolveDefaultRunAgentName(cfg), prompt: raw };

	const [, first, rest = ""] = match;
	if (cfg.agents[first]) {
		return { agentName: first, prompt: rest.trim() };
	}

	return { agentName: resolveDefaultRunAgentName(cfg), prompt: raw };
}

function summarizePrompt(prompt: string): string {
	const compact = prompt.replace(/\s+/g, " ").trim();
	if (compact.length <= 96) return compact;
	return `${compact.slice(0, 93)}...`;
}

function runRecordPath(cwd: string, id: string): string {
	return join(cwd, RUNS_DIR, `${id}.json`);
}

function writeRunRecord(cwd: string, record: ScRunRecord): string {
	const path = runRecordPath(cwd, record.id);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(record, null, 2));
	return path;
}

function updateRunRecord(
	cwd: string,
	record: ScRunRecord,
	patch: Partial<ScRunRecord>,
	now: () => number = Date.now,
): ScRunRecord {
	const next = { ...record, ...patch, updatedAt: patch.updatedAt ?? now() };
	writeRunRecord(cwd, next);
	return next;
}

function buildRunSummary(record: ScRunRecord): string {
	const commits = record.commits?.length ? record.commits.join(", ") : "none";
	return `Run ${record.id} ${record.status}: agent ${record.agent}; branch ${record.branch || "(pending)"}; commits ${commits}; log ${record.logPath || "(pending)"}`;
}

function resolveAgentRuntimeSettings(agent: AgentDef, cfg: SandcastleConfig): AgentRuntimeSettings {
	return {
		model: agent.model || cfg.defaultModel || DEFAULT_MODEL,
		sandbox: agent.sandbox || cfg.defaultSandbox || DEFAULT_SANDBOX,
	};
}

function resolveScRunSettings(cwd: string, id: string, agent: AgentDef, cfg: SandcastleConfig): ScRunSettings {
	const runtime = resolveAgentRuntimeSettings(agent, cfg);
	const logPath = join(cwd, LOGS_DIR, `${id}.log`);
	const branchStrategy: RunOptions["branchStrategy"] = agent.branch
		? { type: "branch", branch: agent.branch }
		: undefined;
	return { ...runtime, logPath, branchStrategy };
}

function registerScRunCommand(
	pi: ExtensionAPI,
	sandcastle: SandcastleRunCapability,
	deps: SandcastleRunDeps,
) {
	pi.registerCommand("sc:run", {
		description: "Run one Sandcastle-backed agent directly: /sc:run [agent] [prompt]",
		handler: async (args, ctx) => {
			const cfg = await loadConfig(ctx.cwd);
			const { agentName, prompt } = resolveRunInvocation(args, cfg);
			if (!agentName) {
				ctx.ui.notify("No Sandcastle agents are configured. Run /sc:config setup, then edit .pi/sandcastle/agents.yaml.", "error");
				return;
			}
			if (!prompt) {
				ctx.ui.notify("Usage: /sc:run [agent] <prompt>", "error");
				return;
			}

			const agent = cfg.agents[agentName];
			if (!agent) {
				ctx.ui.notify(`Unknown agent '${agentName}'. Available agents: ${Object.keys(cfg.agents).join(", ") || "none"}.`, "error");
				return;
			}

			const id = deps.randomId?.() ?? randomUUID();
			const now = deps.now ?? Date.now;
			const record: ScRunRecord = {
				id,
				agent: agentName,
				prompt,
				promptSummary: summarizePrompt(prompt),
				status: "started",
				createdAt: now(),
				updatedAt: now(),
			};
			writeRunRecord(ctx.cwd, record);

			const runSettings = resolveScRunSettings(ctx.cwd, id, agent, cfg);
			mkdirSync(dirname(runSettings.logPath), { recursive: true });

			const runningRecord = updateRunRecord(ctx.cwd, record, {
				status: "running",
				startedAt: now(),
				logPath: runSettings.logPath,
			}, now);

			try {
				const result = await sandcastle.run({
					agent: sandcastle.makeAgent(runSettings.model),
					sandbox: sandcastle.makeSandbox(runSettings.sandbox),
					cwd: ctx.cwd,
					prompt,
					maxIterations: 1,
					name: `sc-run:${id}`,
					branchStrategy: runSettings.branchStrategy,
					logging: {
						type: "file",
						path: runSettings.logPath,
						verbose: true,
					},
				});

				const completedRecord = updateRunRecord(ctx.cwd, runningRecord, {
					status: "completed",
					finishedAt: now(),
					branch: result.branch,
					commits: result.commits.map((commit) => commit.sha),
					logPath: result.logFilePath || runSettings.logPath,
				}, now);
				ctx.ui.notify(buildRunSummary(completedRecord), "success");
			} catch (error) {
				const failedRecord = updateRunRecord(ctx.cwd, runningRecord, {
					status: "failed",
					finishedAt: now(),
					error: error instanceof Error ? error.message : String(error),
				}, now);
				ctx.ui.notify(buildRunSummary(failedRecord), "error");
			}
		},
	});
}

interface PipelineRunStepRecord {
	index: number;
	agent: string;
	status: "running" | "completed" | "failed";
	branch?: string;
	commits: string[];
	logPath: string;
	error?: string;
}

interface PipelineRunRecord {
	id: string;
	pipeline: string;
	prompt: string;
	status: "running" | "completed" | "failed";
	branchStrategy: PipelineBranchStrategy;
	branch?: string;
	worktreePath?: string;
	logDir: string;
	recordPath: string;
	startedAt: string;
	completedAt?: string;
	steps: PipelineRunStepRecord[];
	error?: string;
}

interface PipelineExecutionDeps {
	createWorktree?: typeof createWorktree;
	claudeCode?: typeof claudeCode;
	loadSandboxProvider?: (kind: AgentDef["sandbox"] | undefined) => Promise<any>;
	now?: () => number;
}

function sanitizePathSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "pipeline";
}

function parsePipelineCommandArgs(args: string): { pipeline: string; prompt: string } {
	const input = args.trim();
	if (!input) return { pipeline: "", prompt: "" };
	const separatorIndex = input.search(/\s/);
	if (separatorIndex === -1) return { pipeline: input, prompt: "" };
	return { pipeline: input.slice(0, separatorIndex), prompt: input.slice(separatorIndex).trimStart() };
}

function buildPipelineStepLogPath(logDir: string, index: number, agent: string): string {
	return join(logDir, `${String(index + 1).padStart(2, "0")}-${sanitizePathSegment(agent)}.log`);
}

function resolvePipelineStepPrompt(template: string | undefined, input: string, original: string): string {
	return (template || DEFAULT_STEP_PROMPT).replace(/\$INPUT/g, input).replace(/\$ORIGINAL/g, original);
}

function getPipelineCommitShas(commits: Array<{ sha: string }> | undefined): string[] {
	return (commits || []).map((commit) => commit.sha);
}

function summarizePipelineStepResult(
	pipelineName: string,
	agent: string,
	branch: string | undefined,
	commits: string[],
	logPath: string,
): string {
	return [
		`Pipeline: ${pipelineName}`,
		`Step: ${agent}`,
		`Branch: ${branch}`,
		`Commits: ${commits.join(", ") || "none"}`,
		`Log: ${logPath}`,
	].join("\n");
}

function resolvePipelineBranchStrategy(pipelineName: string, pipeline: PipelineDef): PipelineBranchStrategy {
	const branch = `sandcastle/${sanitizePathSegment(pipelineName)}`;
	const branchStrategy = pipeline.branchStrategy;
	if (!branchStrategy) return { type: "branch", branch };
	if (branchStrategy.type === "merge-to-head") return { type: "merge-to-head" };
	return {
		type: "branch",
		branch: branchStrategy.branch || branch,
		...(branchStrategy.baseBranch ? { baseBranch: branchStrategy.baseBranch } : {}),
	};
}

async function loadPipelineSandboxProvider(kind: AgentDef["sandbox"] | undefined): Promise<any> {
	if (kind === "podman") return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/podman.js")).podman();
	if (kind === "vercel") return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/vercel.js")).vercel();
	if (kind === "no-sandbox") return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/no-sandbox.js")).noSandbox();
	return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/docker.js")).docker();
}

async function writePipelineRunRecord(record: PipelineRunRecord): Promise<void> {
	mkdirSync(dirname(record.recordPath), { recursive: true });
	writeFileSync(record.recordPath, JSON.stringify(record, null, 2));
}

export async function executePipeline(
	cwd: string,
	pipelineName: string,
	prompt: string,
	deps: PipelineExecutionDeps = {},
): Promise<PipelineRunRecord> {
	const cfg = await loadConfig(cwd);
	const pipeline = cfg.pipelines[pipelineName];
	if (!pipeline) {
		const available = Object.keys(cfg.pipelines).sort();
		throw new Error(
			`Unknown pipeline '${pipelineName}'. Available pipelines: ${available.length ? available.join(", ") : "(none)"}`,
		);
	}

	const now = deps.now || Date.now;
	const startedAtMs = now();
	const id = `${startedAtMs.toString(36)}-${sanitizePathSegment(pipelineName)}`;
	const runDir = join(cwd, PIPELINE_RUNS_DIR, id);
	const recordPath = join(runDir, "record.json");
	const logDir = join(runDir, "logs");
	const branchStrategy = resolvePipelineBranchStrategy(pipelineName, pipeline);
	const createWorktreeImpl = deps.createWorktree || createWorktree;
	const claudeCodeImpl = deps.claudeCode || claudeCode;
	const loadSandboxProvider = deps.loadSandboxProvider || loadPipelineSandboxProvider;
	const record: PipelineRunRecord = {
		id,
		pipeline: pipelineName,
		prompt,
		status: "running",
		branchStrategy,
		logDir,
		recordPath,
		startedAt: new Date(startedAtMs).toISOString(),
		steps: [],
	};
	let worktree: Awaited<ReturnType<typeof createWorktreeImpl>> | undefined;

	try {
		worktree = await createWorktreeImpl({
			cwd,
			branchStrategy,
			copyToWorktree: pipeline.copyToWorktree,
		});
		record.branch = worktree.branch;
		record.worktreePath = worktree.worktreePath;
		await writePipelineRunRecord(record);

		let input = prompt;
		for (const [index, step] of pipeline.steps.entries()) {
			const stepRecord: PipelineRunStepRecord = {
				index,
				agent: step.agent,
				status: "running",
				commits: [],
				logPath: buildPipelineStepLogPath(logDir, index, step.agent),
			};
			record.steps.push(stepRecord);
			await writePipelineRunRecord(record);

			const sandbox = await loadSandboxProvider(
				step.sandbox || pipeline.sandbox || cfg.defaultSandbox,
			);
			const stepPrompt = resolvePipelineStepPrompt(step.prompt, input, prompt);
			const result = await worktree.run({
				agent: claudeCodeImpl(step.model || pipeline.model || cfg.defaultModel || DEFAULT_MODEL),
				sandbox,
				prompt: stepPrompt,
				maxIterations: step.maxIterations || 1,
				logging: {
					type: "file",
					path: stepRecord.logPath,
					verbose: true,
				},
			});

			const commitShas = getPipelineCommitShas(result.commits);
			stepRecord.status = "completed";
			stepRecord.branch = result.branch;
			stepRecord.commits = commitShas;
			record.branch = result.branch || record.branch;
			stepRecord.logPath = result.logFilePath || stepRecord.logPath;
			input = summarizePipelineStepResult(pipelineName, step.agent, result.branch, commitShas, stepRecord.logPath);
			await writePipelineRunRecord(record);
		}
		record.status = "completed";
		record.completedAt = new Date(now()).toISOString();
		await writePipelineRunRecord(record);
		return record;
	} catch (error) {
		record.status = "failed";
		record.error = error instanceof Error ? error.message : String(error);
		record.completedAt = new Date(now()).toISOString();
		const lastStep = record.steps.at(-1);
		if (lastStep && lastStep.status === "running") {
			lastStep.status = "failed";
			lastStep.error = record.error;
		}
		await writePipelineRunRecord(record);
		throw error;
	} finally {
		await worktree?.close().catch(() => undefined);
	}
}

function renderWidget(runs: Map<string, RunState>, team: string): string[] {
	const active = [...runs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 8);
	const lines = [`Sandcastle team: ${team || "(none)"} · runs: ${runs.size}`];
	for (const run of active) {
		const age = Math.round((Date.now() - run.startedAt) / 1000);
		const commits = run.commits?.length ? ` · ${run.commits.length} commit(s)` : "";
		lines.push(`${run.status.padEnd(9)} ${run.agent.padEnd(12)} ${age}s · ${run.lastLine || run.task.slice(0, 48)}${commits}`);
	}
	return lines;
}

export default function piSandcastle(
	pi: ExtensionAPI,
	deps: PiSandcastleDependencies = {},
) {
	const runs = new Map<string, RunState>();
	let activeTeam = "default";
	let widgetCtx: { ui: { setWidget: (id: string, lines: string[] | undefined) => void; notify: (message: string, type?: string) => void } } | undefined;
	const sandcastle = deps.sandcastle ?? createDefaultSandcastleRunCapability();
	const backlogDeps = deps.backlog || {};

	function refreshWidget() {
		widgetCtx?.ui.setWidget("pi-sandcastle", renderWidget(runs, activeTeam));
	}

	function helpText(): string {
		return `Sandcastle commands\n\nSetup and configuration:\n  /sc:config setup\n    Create the local config/runner scaffold.\n\n  /sc:config show|get|set|reset|validate\n    Inspect and maintain repo-local Sandcastle config.\n\nExecution:\n  /sc:run [agent] <prompt>\n    Run one Sandcastle-backed agent directly.\n\n  /sc:pipeline <pipeline> [prompt]\n    Run a fixed-domain pipeline directly.\n\nRun management:\n  /sc:runs\n    Show durable Sandcastle runs.\n\n  /sc:status [run-id]\n    Inspect a current, latest, or specified Sandcastle run.\n\n  /sc:logs [run-id]\n    Show the stored log path for a run.\n\n  /sc:cancel [run-id]\n    Cancel active Sandcastle work.\n\n  /sc:resume [run-id]\n    Resume resumable Sandcastle work.\n\nBacklog views and processing:\n  /backlog:list [query]\n    List backlog items without mutation.\n\n  /backlog:inspect <item-id>\n    Inspect one backlog item without mutation.\n\n  /backlog:plan [query] --iterations N\n    Plan read-only backlog iterations.\n\n  /backlog:next [query]\n    Plan the next backlog iteration.\n\n  /backlog:process [query] --pipeline <pipeline>\n    Start durable backlog processing.\n\n  /backlog:runs|status|resume\n    Manage durable backlog processing runs.`;
	}

	function getBacklogResumeCapability(ctx: any): ((record: unknown) => Promise<unknown> | unknown) | undefined {
		return ctx?.backlogResume
			?? ctx?.capabilities?.backlog?.resume
			?? ctx?.capabilities?.sandcastle?.resume
			?? ctx?.sandcastle?.resume
			?? ctx?.resume;
	}

	registerScRunCommand(pi, sandcastle, deps);

	async function notifyBacklogPlan(args: string, ctx: any, overrides?: { iterations?: number }): Promise<void> {
		try {
			const plan = await buildBacklogPlan(ctx.cwd, args, overrides);
			ctx.ui.notify(formatBacklogPlan(plan), "info");
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	}

	async function dispatch(cwd: string, agentName: string, task: string, ctx?: any): Promise<RunState> {
		const cfg = await loadConfig(cwd);
		const agent = cfg.agents[agentName];
		if (!agent) throw new Error(`Unknown Sandcastle agent '${agentName}'. Run /sc:config show to inspect configured agents.`);
		const id = `${Date.now().toString(36)}-${agentName}`;
		const resultPath = join(cwd, RESULTS_DIR, `${id}.json`);
		const logPath = join(cwd, RESULTS_DIR, `${id}.log`);
		const branch = agent.branch || `sandcastle/${agentName}/${id}`;
		const jobPath = join(cwd, JOBS_DIR, `${id}.json`);
		const runtime = resolveAgentRuntimeSettings(agent, cfg);
		const job = {
			id,
			name: `${agentName}:${id}`,
			agent: agentName,
			cwd,
			model: runtime.model,
			sandbox: runtime.sandbox,
			systemPrompt: agent.systemPrompt || "",
			prompt: task,
			maxIterations: agent.maxIterations || 1,
			branch,
			copyToWorktree: agent.copyToWorktree,
			logPath,
			resultPath,
		};
		writeFileSync(jobPath, JSON.stringify(job, null, 2));

		const state: RunState = { id, agent: agentName, task, status: "running", startedAt: Date.now(), lastLine: "starting", logPath, resultPath, branch };
		runs.set(id, state);
		refreshWidget();

		const proc = spawn("node", [join(cwd, RUNNER_PATH), jobPath], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		state.proc = proc;
		let stderr = "";
		proc.stdout.setEncoding("utf8");
		proc.stdout.on("data", (chunk) => {
			for (const line of String(chunk).split("\n")) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					if (event.type === "text" || event.type === "raw") state.lastLine = String(event.text || "").trim().slice(-120) || state.lastLine;
					if (event.type === "tool") state.lastLine = `tool: ${event.tool}`;
					if (event.type === "done") {
						state.status = "done";
						state.branch = event.branch || state.branch;
						state.commits = event.commits || [];
						state.lastLine = `done on ${state.branch}`;
					}
					if (event.type === "error") {
						state.status = "error";
						state.lastLine = String(event.error || "error").split("\n")[0].slice(0, 120);
					}
				} catch {
					state.lastLine = line.trim().slice(-120);
				}
				refreshWidget();
			}
		});
		proc.stderr.setEncoding("utf8");
		proc.stderr.on("data", (chunk) => {
			stderr += String(chunk);
			state.lastLine = stderr.trim().split("\n").pop()?.slice(0, 120) || state.lastLine;
			refreshWidget();
		});
		proc.on("close", (code) => {
			if (state.status === "running") state.status = code === 0 ? "done" : "error";
			if (state.status === "error" && stderr.trim()) state.lastLine = stderr.trim().split("\n").pop()?.slice(0, 120) || state.lastLine;
			refreshWidget();
			ctx?.ui?.notify(`Sandcastle ${agentName} ${state.status}: ${id}`, state.status === "done" ? "success" : "error");
		});
		return state;
	}

	async function runChain(cwd: string, chainName: string, original: string, ctx?: any): Promise<void> {
		const cfg = await loadConfig(cwd);
		const chain = cfg.chains[chainName];
		if (!chain) throw new Error(`Unknown chain '${chainName}'. Chains: ${Object.keys(cfg.chains).join(", ")}`);
		let input = original;
		for (const step of chain) {
			const prompt = step.prompt.replace(/\$INPUT/g, input).replace(/\$ORIGINAL/g, original);
			const run = await dispatch(cwd, step.agent, prompt, ctx);
			await new Promise<void>((resolve) => run.proc?.on("close", () => resolve()));
			if (run.status !== "done") break;
			input = `Run ${run.id} completed. Branch: ${run.branch}. Commits: ${(run.commits || []).join(", ") || "none"}. Log: ${run.logPath}. Result: ${run.resultPath}.`;
		}
	}

	async function delegateDefault(cwd: string, task: string, ctx?: any): Promise<void> {
		const cfg = await loadConfig(cwd);
		if (cfg.chains["explore-plan-review"]) {
			await runChain(cwd, "explore-plan-review", task, ctx);
			return;
		}
		const team = cfg.teams[activeTeam] || [];
		const agent = team.includes("researcher") ? "researcher" : team[0] || Object.keys(cfg.agents)[0];
		if (!agent) throw new Error("No Sandcastle agents configured. Run /sc:config setup, then edit .pi/sandcastle/agents.yaml.");
		await dispatch(cwd, agent, task, ctx);
	}

	async function delegateOpenWork(cwd: string, focus: string, ctx?: any): Promise<void> {
		const task = `Inspect available open work for this repository and recommend what to pick up next.\n\nLook for, in order when available:\n1. GitHub issues and PRs via gh (for example: gh issue list, gh pr list).\n2. Local backlog/work-item directories, docs, TODO/FIXME comments, and project planning files.\n3. Failing or skipped tests that indicate unfinished work.\n\nFocus: ${focus || "general project work"}\n\nOutput:\n- Ranked open work items with source/link/file evidence.\n- Suggested first item to delegate next.\n- A ready-to-run /sc:run command for the top item.\n\nDo not modify files. End with <promise>COMPLETE</promise>.`;
		const cfg = await loadConfig(cwd);
		const team = cfg.teams[activeTeam] || [];
		const agent = team.includes("researcher") ? "researcher" : team[0] || Object.keys(cfg.agents)[0];
		if (!agent) throw new Error("No Sandcastle agents configured. Run /sc:config setup, then edit .pi/sandcastle/agents.yaml.");
		await dispatch(cwd, agent, task, ctx);
	}

	async function planBacklogProcessing(cwd: string, query: string): Promise<BacklogPlanResult> {
		if (backlogDeps.plan) return backlogDeps.plan(cwd, query);
		return defaultPlanBacklogProcessing(cwd, query);
	}

	function firstConfiguredAgentName(cfg: SandcastleConfig): string | undefined {
		return Object.keys(cfg.agents)[0];
	}

	function selectConfiguredAgent(cfg: SandcastleConfig, preferredAgents: string[], fallback: string): string {
		for (const agentName of preferredAgents) {
			if (cfg.agents[agentName]) return agentName;
		}
		return firstConfiguredAgentName(cfg) || fallback;
	}

	function selectAgentForPipeline(pipeline: string, cfg: SandcastleConfig): string {
		switch (pipeline) {
			case "review":
				return selectConfiguredAgent(cfg, ["reviewer", "builder"], "builder");
			case "research":
			case "inspect":
				return selectConfiguredAgent(cfg, ["researcher"], "researcher");
			case "fix":
			case "implement":
			default:
				return selectConfiguredAgent(cfg, ["builder"], "builder");
		}
	}

	async function dispatchBacklogItem(
		cwd: string,
		agentName: string,
		record: BacklogProcessRecord,
		item: BacklogItem,
		ctx?: any,
	): Promise<BacklogItemDispatchResult> {
		const prompt = `Process backlog item ${item.id}: ${item.title}\n\nPipeline: ${record.pipeline}\nQuery: ${record.query}\n\nSource: ${item.sourcePath}\n${item.summary ? `\nSummary: ${item.summary}\n` : "\n"}\nDo not modify unrelated work. End with <promise>COMPLETE</promise>.`;
		const run = await dispatch(cwd, agentName, prompt, ctx);
		await new Promise<void>((resolve) => run.proc?.once("close", () => resolve()));
		return { branch: run.branch, logPath: run.logPath, status: run.status === "done" ? "done" : "error" };
	}

	async function dispatchBacklogItemsSequentially(
		cwd: string,
		agentName: string,
		record: BacklogProcessRecord,
		ctx?: any,
	): Promise<BacklogItemDispatchResult[]> {
		const results: BacklogItemDispatchResult[] = [];
		for (const item of record.resolvedItems) results.push(await dispatchBacklogItem(cwd, agentName, record, item, ctx));
		return results;
	}

	async function executeBacklogProcessing(
		cwd: string,
		record: BacklogProcessRecord,
		parallel: boolean,
		ctx?: any,
	): Promise<BacklogExecutionResult> {
		const recordPath = getBacklogRunRecordPath(cwd, record.id);
		if (backlogDeps.execute) {
			return backlogDeps.execute(cwd, {
				runId: record.id,
				query: record.query,
				pipeline: record.pipeline,
				items: record.resolvedItems,
				parallel,
				recordPath,
			});
		}

		const cfg = await loadConfig(cwd);
		const agentName = selectAgentForPipeline(record.pipeline, cfg);
		const shouldRunInParallel = parallel && record.resolvedItems.length > 1;
		const dispatched = shouldRunInParallel
			? await Promise.all(record.resolvedItems.map((item) => dispatchBacklogItem(cwd, agentName, record, item, ctx)))
			: await dispatchBacklogItemsSequentially(cwd, agentName, record, ctx);

		const status = dispatched.every((entry) => entry.status === "done") ? "done" : "error";

		return {
			branches: dispatched.map((entry) => entry.branch).filter((branch): branch is string => !!branch),
			logs: dispatched.map((entry) => entry.logPath).filter((logPath): logPath is string => !!logPath),
			status,
		};
	}

	pi.on("session_start", async (_event, ctx) => {
		widgetCtx = ctx as any;
		try {
			const cfg = await loadConfig(ctx.cwd);
			activeTeam = cfg.defaultTeam || activeTeam;
			refreshWidget();
		} catch (error) {
			ctx.ui.notify(`pi-sandcastle config error: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		try {
			const cfg = await loadConfig(ctx.cwd);
			const team = cfg.teams[activeTeam] || [];
			if (team.length === 0) return;
			const agentLines = team.map((name) => {
				const agent = cfg.agents[name];
				return `- ${name}: ${agent?.description || "configured delegation agent"}`;
			}).join("\n");
			const chainLines = Object.keys(cfg.chains).map((name) => `- ${name}`).join("\n") || "- none";
			return {
				systemPrompt: `${event.systemPrompt}\n\n## Pi Sandcastle delegation mode\nActive Sandcastle team: ${activeTeam}\nAvailable agents:\n${agentLines}\nAvailable chains:\n${chainLines}\n\nPrefer delegate_agent for delegable research, implementation, review, and parallel AFK work. Dispatch prompts must be self-contained and include expected output/artifacts. Do not dispatch agents outside the active team unless the user explicitly asks. Use /backlog:list and /backlog:inspect to inspect work, /sc:run to start agent work, and /sc:runs to inspect progress.`,
			};
		} catch {
			return;
		}
	});

	pi.on("session_shutdown", () => {
		for (const run of runs.values()) if (run.status === "running") run.proc?.kill("SIGTERM");
	});

	registerRunManagementCommands(pi);

	pi.registerCommand("sc:config", {
		description: "Show, set up, edit, reset, or validate Sandcastle repo config",
		handler: async (args, ctx) => {
			const input = args.trim();
			const [subcommand = "show", ...rest] = input ? input.split(/\s+/) : ["show"];
			try {
				switch (subcommand) {
					case "show": {
						const cfg = await loadConfig(ctx.cwd);
						ctx.ui.notify(JSON.stringify(cfg, null, 2), "info");
						break;
					}
					case "setup": {
						ensureScaffold(ctx.cwd);
						ctx.ui.notify(`Created/verified ${CONFIG_PATH} and ${RUNNER_PATH}`, "success");
						break;
					}
					case "get": {
						const path = rest.shift();
						if (!path) {
							ctx.ui.notify("Usage: /sc:config get <path>", "error");
							break;
						}
						const cfg = await loadConfig(ctx.cwd);
						const value = readConfigValue(cfg, path);
						if (value === undefined) {
							ctx.ui.notify(`Unknown or unset config path '${path}'.`, "error");
							break;
						}
						ctx.ui.notify(formatConfigValue(value), "info");
						break;
					}
					case "set": {
						const path = rest.shift();
						const rawValue = rest.join(" ");
						if (!path || !rawValue) {
							ctx.ui.notify("Usage: /sc:config set <path> <value>", "error");
							break;
						}
						if (!supportedConfigPath(path)) {
							ctx.ui.notify(`Unsupported config path '${path}'.`, "error");
							break;
						}
						const current = readConfigText(ctx.cwd);
						const updated = setConfigValueInText(current, path, parseScalar(rawValue));
						writeConfigText(ctx.cwd, updated);
						ctx.ui.notify(`Updated ${path}.`, "success");
						break;
					}
					case "reset": {
						const path = rest.shift();
						if (path && !supportedConfigPath(path)) {
							ctx.ui.notify(`Unsupported config path '${path}'.`, "error");
							break;
						}
						if (path && defaultConfigValue(path) === undefined) {
							ctx.ui.notify(`Unsupported config path '${path}'.`, "error");
							break;
						}
						const current = readConfigText(ctx.cwd);
						const updated = resetConfigText(current, path);
						writeConfigText(ctx.cwd, updated);
						ctx.ui.notify(path ? `Reset ${path} to defaults.` : "Reset supported config paths to defaults.", "success");
						break;
					}
					case "validate": {
						let cfg: SandcastleConfig;
						try {
							cfg = await loadExistingConfig(ctx.cwd);
						} catch {
							cfg = { agents: {}, teams: {}, chains: {} };
						}
						const issues = validateConfig(ctx.cwd, cfg);
						if (issues.length) ctx.ui.notify(`Sandcastle config validation failed:\n- ${issues.join("\n- ")}`, "error");
						else ctx.ui.notify("Sandcastle config validation passed.", "success");
						break;
					}
					default:
						ctx.ui.notify(`Unknown /sc:config subcommand '${subcommand}'. Use show, setup, get, set, reset, or validate.`, "error");
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
			refreshWidget();
		},
	});

	pi.registerCommand("sc:pipeline", {
		description: "Run a fixed-domain pipeline: /sc:pipeline <pipeline> [prompt]",
		handler: async (args, ctx) => {
			const { pipeline, prompt } = parsePipelineCommandArgs(args);
			if (!pipeline) {
				ctx.ui.notify("Usage: /sc:pipeline <pipeline> [prompt]", "error");
				return;
			}
			try {
				const record = await executePipeline(ctx.cwd, pipeline, prompt, deps.pipeline);
				const stepSummary = record.steps.map((step) => `${step.agent}:${step.status}`).join(", ");
				ctx.ui.notify(
					`Pipeline ${record.pipeline} completed as ${record.id}. Branch: ${record.branch || record.worktreePath || "unknown"}. Logs: ${record.logDir}. Steps: ${stepSummary || "none"}.`,
					"success",
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("backlog:process", {
		description: "Start durable backlog processing: /backlog:process [query] --pipeline <pipeline>",
		handler: async (args, ctx) => {
			let baseRecord: BacklogProcessRecord | undefined;
			try {
				const { query, pipeline: explicitPipeline } = parseBacklogProcessArgs(args);
				const planning = await planBacklogProcessing(ctx.cwd, query);
				const iteration = planning.iterations[0];
				if (!iteration) {
					ctx.ui.notify("No backlog items were selected for processing.", "error");
					return;
				}

				const pipeline = explicitPipeline || iteration.recommendedPipeline || "implement";
				const startedAt = getBacklogTimestamp(backlogDeps.now);
				const runId = createBacklogRunId(startedAt);
				baseRecord = {
					id: runId,
					query,
					resolvedItems: iteration.items,
					pipeline,
					status: "running",
					branches: [],
					logs: [],
					startedAt,
					updatedAt: startedAt,
				};
				const recordPath = writeBacklogRunRecord(ctx.cwd, baseRecord);
				const execution = await executeBacklogProcessing(ctx.cwd, baseRecord, iteration.supportsParallel, ctx);
				const endedAt = getBacklogTimestamp(backlogDeps.now);
				const finalRecord: BacklogProcessRecord = {
					...baseRecord,
					status: execution.status || "done",
					branches: execution.branches || [],
					logs: execution.logs || [],
					updatedAt: endedAt,
					endedAt,
				};
				writeBacklogRunRecord(ctx.cwd, finalRecord);
				ctx.ui.notify(
					`Backlog process ${finalRecord.status}: ${runId} · pipeline ${pipeline} · items ${finalRecord.resolvedItems.length} · record ${recordPath}${finalRecord.branches.length ? ` · branches ${finalRecord.branches.join(", ")}` : ""}${finalRecord.logs.length ? ` · logs ${finalRecord.logs.join(", ")}` : ""}`,
					finalRecord.status === "done" ? "success" : "error",
				);
			} catch (error) {
				if (baseRecord) {
					const endedAt = getBacklogTimestamp(backlogDeps.now);
					writeBacklogRunRecord(ctx.cwd, {
						...baseRecord,
						status: "error",
						updatedAt: endedAt,
						endedAt,
					});
				}
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("backlog:plan", {
		description: "Plan read-only backlog iterations: /backlog:plan [query] --iterations N",
		handler: async (args, ctx) => notifyBacklogPlan(args, ctx),
	});

	pi.registerCommand("backlog:next", {
		description: "Plan the next backlog iteration: /backlog:next [query]",
		handler: async (args, ctx) => notifyBacklogPlan(args, ctx, { iterations: 1 }),
	});

	registerBacklogCommands(pi);
	pi.registerCommand("backlog:runs", {
		description: "List backlog processing runs: /backlog:runs [query]",
		handler: async (args, ctx) => {
			const runs = listBacklogRuns(ctx.cwd, args.trim());
			ctx.ui.notify(formatBacklogRunList(runs), "info");
		},
	});

	pi.registerCommand("backlog:status", {
		description: "Inspect a backlog processing run: /backlog:status [run-id]",
		handler: async (args, ctx) => {
			const selection = selectBacklogRunForStatus(listBacklogRuns(ctx.cwd), args.trim());
			const message = formatStatusSelection(selection);
			ctx.ui.notify(message, selection.kind === "record" ? "info" : "error");
		},
	});

	pi.registerCommand("backlog:resume", {
		description: "Resume a backlog processing run: /backlog:resume [run-id]",
		handler: async (args, ctx) => {
			const resumeCapability = getBacklogResumeCapability(ctx);
			const result = await resumeBacklogRun(ctx.cwd, args.trim(), resumeCapability);
			ctx.ui.notify(result.message, result.ok ? "success" : "error");
		},
	});

	pi.registerTool({
		name: "delegate_agent",
		label: "Delegate Agent",
		description: "Delegate work to a YAML-defined subagent and return the run id, branch, and artifact paths.",
		promptSnippet: "Delegate codebase work to a configured subagent",
		promptGuidelines: ["Use delegate_agent when work can be safely delegated to a configured subagent."],
		parameters: ToolType.Object({
			type: "object",
			properties: {
				agent: { type: "string", description: "Configured agent name from .pi/sandcastle/agents.yaml" },
				task: { type: "string", description: "Self-contained delegated task prompt" },
			},
			required: ["agent", "task"],
			additionalProperties: false,
		}),
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const { agent, task } = params as { agent: string; task: string };
			const cfg = await loadConfig(ctx.cwd);
			const team = cfg.teams[activeTeam] || [];
			if (team.length > 0 && !team.includes(agent)) {
				return {
					isError: true,
					content: [{ type: "text", text: `Agent '${agent}' is not in active team '${activeTeam}'. Team members: ${team.join(", ")}. Update the active team configuration before dispatching.` }],
				};
			}
			onUpdate?.({ content: [{ type: "text", text: `Dispatching ${agent} via Sandcastle...` }] });
			const run = await dispatch(ctx.cwd, agent, task, ctx);
			return {
				content: [{ type: "text", text: `Dispatched ${agent} as ${run.id}. Branch: ${run.branch}. Log: ${run.logPath}. Result: ${run.resultPath}. Use /sc:runs for progress.` }],
				details: { id: run.id, agent, branch: run.branch, logPath: run.logPath, resultPath: run.resultPath },
			};
		},
	});
}
