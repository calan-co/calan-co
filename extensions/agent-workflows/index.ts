// Agent Workflows extension: Pi-native delegation UI backed by Sandcastle sandboxes.
// Commands: /work:* command surfaces backed by an Agent Workflows execution runtime adapter.

export {
	GLOBAL_NODE_DISCRIMINATOR,
	MERGEABLE_RESULT_INTERFACE,
	RESULT_CONTRACTS,
	assertValidWorkflowModel,
	validateWorkflowModel,
	type ResultContract,
	type WorkflowNodeModel,
	type WorkflowValidationDiagnostic,
	type WorkflowValidationResult,
} from "./workflow-model.ts";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SelectList as PiSelectList, matchesKey } from "@earendil-works/pi-tui";
import type { SelectListTheme as PiSelectListTheme } from "@earendil-works/pi-tui";
import {
	claudeCode,
	codex,
	copilot,
	cursor,
	opencode,
	pi as piAgent,
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
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { ConfigShadowModel } from "./config-shadow-model.ts";
import { buildSandcastleImage } from "./build-image.ts";
import { registerWorkCommands } from "./work-source.mjs";
import { buildDefaultConfigText, configToYaml, packsToConfig } from "./pipeline-packs.mjs";
import { renderWorkBrief } from "./work-brief.mjs";
import { loadExecutionRuntimePack, listRuntimeAgents, listRuntimePipelines } from "./execution-runtime.ts";
import { executeGraphWorkflow, type CompositeResult, type GitMergeResult, type GraphNodeExecutionContext, type GraphWorkflowNode, type NodeResult } from "./graph-executor.ts";
import {
	runWorkProcess,
	validateExecutablePlanArtifact,
	writeWorkProcessRunRecord,
	type WorkExecutionContext,
	type WorkExecutionGroup,
	type WorkItem,
	type WorkProcessRunRecord,
} from "./orchestrator.ts";
import {
	formatStatusSelection,
	formatWorkRunList,
	listWorkRuns,
	resumeWorkRun,
	selectWorkRunForStatus,
} from "./work-runs.mjs";

const ToolType = {
	Object(schema: Record<string, unknown>) {
		return schema;
	},
};

interface SelectItem {
	value: string;
	label: string;
	description?: string;
}

interface AgentDef {
	name: string;
	description?: string;
	model?: string;
	sandbox?: "docker" | "podman" | "vercel" | "no-sandbox";
	provider?: "claude" | "claude-code" | "pi" | "codex" | "cursor" | "opencode" | "copilot";
	systemPrompt?: string;
	kind?: "planWork" | "runRole" | "review" | "merge" | string;
	maxIterations?: number;
	branch?: string;
	copyToWorktree?: string[];
}

type SandcastleSandbox = NonNullable<AgentDef["sandbox"]>;

interface ChainStep {
	role: string;
	prompt: string;
}

interface PipelineStep {
	role: string;
	description?: string;
	prompt: string;
	kind?: string;
	promptOverride?: string;
	sandbox?: AgentDef["sandbox"];
	model?: string;
	maxIterations?: number;
	copyToWorktree?: string[];
	[key: string]: unknown;
}

interface PipelineNodeDef {
	kind?: string;
	needs?: string[];
	role?: string;
	prompt?: string;
	promptOverride?: string;
	nodes?: Record<string, PipelineNodeDef>;
	[key: string]: unknown;
}

interface PipelineBranchStrategyConfig {
	type?: "branch" | "merge-to-head";
	branch?: string;
	baseBranch?: string;
}

interface PipelineDef {
	description?: string;
	kind?: string;
	needs?: string[];
	branchStrategy?: PipelineBranchStrategyConfig;
	sandbox?: AgentDef["sandbox"];
	model?: string;
	copyToWorktree?: string[];
	nodes?: Record<string, PipelineNodeDef>;
	steps: PipelineStep[];
	[key: string]: unknown;
}

type PipelineBranchStrategy = WorktreeBranchStrategy;

interface PromptDef {
	format?: string;
	template?: string;
}

interface SandcastleConfig {
	defaultSandbox?: AgentDef["sandbox"];
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
	prompts: Record<string, PromptDef>;
	agents: Record<string, AgentDef>;
	chains: Record<string, ChainStep[]>;
	pipelines: Record<string, PipelineDef>;
}

type SandcastleProcess = ReturnType<typeof spawn>;
interface WorkItemSource {
	adapter: string;
	id?: string;
	kind?: string;
	path?: string;
	absolutePath?: string;
	url?: string;
	body?: string;
	payload?: unknown;
	raw?: string;
}

interface WorkItem {
	id: string;
	title: string;
	summary?: string;
	body?: string;
	tags: string[];
	source: WorkItemSource;
	sourcePath: string;
	dependencies: string[];
	dependsOn: string[];
	acceptanceCriteria: string[];
	estimate?: number;
	estimated?: number;
}

type BacklogItem = WorkItem;

interface BacklogPlanIteration {
	items: WorkItem[];
	recommendedPipeline?: string;
	supportsParallel: boolean;
	rationale: string;
}

interface BacklogPlanResult {
	query: string;
	iterations: BacklogPlanIteration[];
}

export interface WorkPlanArtifact {
	kind?: "workPlan" | "work-plan";
	scope?: "forecast" | "actionable";
	schemaVersion?: 1;
	summary?: string;
	query?: string;
	actionable?: WorkPlanArtifact;
	iterations: WorkPlanIteration[];
}

export interface WorkPlanIteration {
	id?: string;
	title?: string;
	items: WorkPlanItemRef[];
	dependsOn?: string[];
	rationale?: string;
	classifications?: Record<string, unknown>;
	parallelizable?: boolean;
	hitl?: string[];
}

export interface WorkPlanItemRef {
	id: string;
	title?: string;
	summary?: string;
	sourcePath?: string;
	rationale?: string;
	dependsOn?: string[];
	classifications?: Record<string, unknown>;
	[key: string]: unknown;
}

const FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS = new Set(["pipeline", "pipelines", "pipelineName", "recommendedPipeline", "recommendedPipelines", "branch", "branches", "branchName"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateOptionalString(scope: string, value: Record<string, unknown>, field: string, errors: string[]): void {
	if (value[field] !== undefined && typeof value[field] !== "string") errors.push(`${scope} ${field} must be a string.`);
}

function validateOptionalStringArray(scope: string, value: Record<string, unknown>, field: string, errors: string[]): void {
	if (value[field] === undefined) return;
	if (!Array.isArray(value[field]) || !(value[field] as unknown[]).every((entry) => typeof entry === "string")) errors.push(`${scope} ${field} must be an array of strings.`);
}

function validateOptionalObject(scope: string, value: Record<string, unknown>, field: string, errors: string[]): void {
	if (value[field] !== undefined && !isRecord(value[field])) errors.push(`${scope} ${field} must be an object.`);
}

function validateForbiddenWorkPlanFields(scope: string, value: unknown, errors: string[]): void {
	if (Array.isArray(value)) {
		for (const entry of value) validateForbiddenWorkPlanFields(scope, entry, errors);
		return;
	}
	if (!isRecord(value)) return;
	for (const [field, child] of Object.entries(value)) {
		if (FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS.has(field)) {
			errors.push(`${scope} must not author execution field '${field}'.`);
			continue;
		}
		validateForbiddenWorkPlanFields(`${scope} ${field}`, child, errors);
	}
}

function formatWorkPlanObject(value: Record<string, unknown>): string {
	return Object.entries(value)
		.map(([key, entry]) => `${key}: ${Array.isArray(entry) ? entry.join(", ") : isRecord(entry) ? formatWorkPlanObject(entry) : String(entry)}`)
		.join("; ");
}

function normalizeWorkPlanShape(value: unknown): unknown {
	if (!isRecord(value)) return value;
	const plan = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
	if (Array.isArray(plan.iterations)) {
		plan.iterations = plan.iterations.map((iteration) => {
			if (!isRecord(iteration)) return iteration;
			const next: Record<string, unknown> = { ...iteration };
			if (isRecord(next.rationale)) next.rationale = formatWorkPlanObject(next.rationale);
			if (Array.isArray(next.items)) {
				next.items = next.items.map((item) => typeof item === "string" ? { id: item } : item);
			}
			return next;
		});
	}
	return plan;
}

export function validateWorkPlanArtifact(value: unknown): string[] {
	const errors: string[] = [];
	if (!isRecord(value)) return ["Planner output must be a JSON object."];
	for (const [field, child] of Object.entries(value)) {
		if (FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS.has(field)) errors.push(`Plan must not author execution field '${field}'.`);
		else if (field !== "iterations") validateForbiddenWorkPlanFields(`Plan ${field}`, child, errors);
	}
	const normalizedValue = normalizeWorkPlanShape(value);
	if (!isRecord(normalizedValue)) return ["Planner output must be a JSON object."];
	if (normalizedValue.kind !== undefined && normalizedValue.kind !== "workPlan" && normalizedValue.kind !== "work-plan") errors.push("Plan kind must be workPlan when provided.");
	if (normalizedValue.scope !== undefined && normalizedValue.scope !== "forecast" && normalizedValue.scope !== "actionable") errors.push("Plan scope must be forecast or actionable when provided.");
	if (normalizedValue.schemaVersion !== undefined && normalizedValue.schemaVersion !== 1) errors.push("Plan schemaVersion must be 1 when provided.");
	validateOptionalString("Plan", normalizedValue, "summary", errors);
	validateOptionalString("Plan", normalizedValue, "query", errors);
	if (normalizedValue.actionable !== undefined) {
		if (!isRecord(normalizedValue.actionable)) errors.push("Plan actionable must be a Work Plan object.");
		else errors.push(...validateWorkPlanArtifact(normalizedValue.actionable).map((error) => `Plan actionable ${error.replace(/^Plan(?:ner output)?\s*/, "")}`));
	}
	if (!Array.isArray(normalizedValue.iterations)) return [...errors, "Planner output must contain an iterations array."];
	for (const [iterationIndex, iteration] of normalizedValue.iterations.entries()) {
		const iterationScope = `Plan iteration ${iterationIndex + 1}`;
		if (!isRecord(iteration)) {
			errors.push(`${iterationScope} must be an object.`);
			continue;
		}
		for (const [field, child] of Object.entries(iteration)) {
			if (FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS.has(field)) errors.push(`${iterationScope} must not author execution field '${field}'.`);
			else if (field !== "items") validateForbiddenWorkPlanFields(`${iterationScope} ${field}`, child, errors);
		}
		validateOptionalString(iterationScope, iteration, "id", errors);
		validateOptionalString(iterationScope, iteration, "title", errors);
		validateOptionalString(iterationScope, iteration, "rationale", errors);
		validateOptionalStringArray(iterationScope, iteration, "dependsOn", errors);
		validateOptionalStringArray(iterationScope, iteration, "hitl", errors);
		validateOptionalObject(iterationScope, iteration, "classifications", errors);
		if (iteration.parallelizable !== undefined && typeof iteration.parallelizable !== "boolean") errors.push(`${iterationScope} parallelizable must be a boolean.`);
		if (!Array.isArray(iteration.items)) {
			errors.push(`${iterationScope} must contain an items array.`);
			continue;
		}
		for (const [itemIndex, item] of iteration.items.entries()) {
			const itemScope = `${iterationScope} item ${itemIndex + 1}`;
			if (!isRecord(item)) {
				errors.push(`${itemScope} must be an object.`);
				continue;
			}
			for (const [field, child] of Object.entries(item)) {
				if (FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS.has(field)) errors.push(`${itemScope} must not author execution field '${field}'.`);
				else validateForbiddenWorkPlanFields(`${itemScope} ${field}`, child, errors);
			}
			if (typeof item.id !== "string" || !item.id.trim()) errors.push(`${itemScope} is missing a canonical item id.`);
			validateOptionalString(itemScope, item, "title", errors);
			validateOptionalString(itemScope, item, "summary", errors);
			validateOptionalString(itemScope, item, "sourcePath", errors);
			validateOptionalString(itemScope, item, "rationale", errors);
			validateOptionalStringArray(itemScope, item, "dependsOn", errors);
			validateOptionalStringArray(itemScope, item, "tags", errors);
			validateOptionalObject(itemScope, item, "classifications", errors);
		}
	}
	return errors;
}

export function normalizeWorkPlanArtifact(value: unknown): WorkPlanArtifact {
	const errors = validateWorkPlanArtifact(value);
	if (errors.length) throw new Error(`Work Plan artifact is not executable:\n- ${errors.join("\n- ")}`);
	const plan = normalizeWorkPlanShape(value) as WorkPlanArtifact;
	plan.scope = plan.scope || "actionable";
	if (plan.actionable) plan.actionable = normalizeWorkPlanArtifact(plan.actionable);
	plan.iterations = plan.iterations.map((iteration) => ({
		...iteration,
		items: iteration.items.map((item) => ({ ...item, id: item.id.trim() })),
	}));
	return plan;
}

export function deriveProcessPipeline(explicitPipeline: string | undefined, cfg: { defaultPipeline?: string }): string {
	return explicitPipeline || cfg.defaultPipeline || "simple-loop";
}

interface BacklogProcessRecord {
	id: string;
	kind?: "work-process";
	query: string;
	resolvedItems: BacklogItem[];
	pipeline: string;
	planId?: string;
	status: "queued" | "running" | "done" | "error";
	branches: string[];
	logs: string[];
	executionContexts?: WorkExecutionContext[];
	executionGroups?: WorkExecutionGroup[];
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

interface RunPlanWorkRoleInput {
	cwd: string;
	args: string;
	role: string;
	task: string;
	ctx?: any;
}

interface BacklogProcessPlanDeps {
	ready?: (cwd: string, args: string) => Promise<string>;
	runPlanWorkRole?: (input: RunPlanWorkRoleInput) => Promise<any>;
	plan?: (cwd: string, query: string) => Promise<BacklogPlanResult>;
	execute?: (
		cwd: string,
		input: {
			runId: string;
			query: string;
			pipeline: string;
			items: WorkItem[];
			parallel: boolean;
			executionContexts: WorkExecutionContext[];
			executionGroups: WorkExecutionGroup[];
			recordPath: string;
		},
	) => Promise<{ branches?: string[]; logs?: string[]; workerStatuses?: Array<{ index: number; role: string; status: "running" | "completed" | "failed"; branch?: string; commits?: string[]; logPath?: string; error?: string }>; status?: BacklogProcessRecord["status"] }>;
	now?: () => number;
}

interface SandboxImageDeps {
	inspectImageCreated?: (cwd: string, provider: "docker" | "podman", imageName: string) => Promise<Date | undefined>;
	buildImage?: (cwd: string, provider: "docker" | "podman", imageName: string) => Promise<void>;
}

interface PiSandcastleDependencies {
	work?: BacklogProcessPlanDeps;
	backlog?: BacklogProcessPlanDeps;
	pipeline?: PipelineExecutionDeps;
	sandcastle?: SandcastleRunCapability;
	image?: SandboxImageDeps;
	now?: () => number;
	randomId?: () => string;
}

interface RunState {
	id: string;
	agent: string;
	task: string;
	status: "queued" | "running" | "done" | "error" | "cancelled";
	startedAt: number;
	endedAt?: number;
	lastLine: string;
	logPath?: string;
	resultPath?: string;
	branch?: string;
	commits?: string[];
	kind?: string;
	nodePath?: string;
	laneId?: string;
	itemId?: string;
	proc?: SandcastleProcess;
}

type RootConfigKey = "defaultSandbox" | "defaultModel" | "defaultPipeline" | "defaultAgent" | "maxWorkers" | "maxIterations" | "workSource" | "workSourceSetupCommand" | "issueTracker" | "issueTrackerSetupCommand" | "imageNamePattern";
type EditableAgentField = "description" | "kind" | "model" | "sandbox" | "maxIterations" | "branch";

const CONFIG_DIR = ".pi/sandcastle";
const CONFIG_PATH = `${CONFIG_DIR}/config.yaml`;
const LEGACY_CONFIG_PATH = `${CONFIG_DIR}/agents.yaml`;
const RUNNER_PATH = `${CONFIG_DIR}/run-job.mjs`;
const JOBS_DIR = `${CONFIG_DIR}/jobs`;
const RESULTS_DIR = `${CONFIG_DIR}/results`;
const SUPPORTED_SANDBOXES = new Set(["docker", "podman", "vercel", "no-sandbox"]);
const DEFAULT_SANDBOX: NonNullable<AgentDef["sandbox"]> = "docker";
const DEFAULT_MODEL = "Agent Default";
const ROOT_CONFIG_KEYS: RootConfigKey[] = ["defaultSandbox", "defaultModel", "defaultPipeline", "defaultAgent", "maxWorkers", "maxIterations", "workSource", "workSourceSetupCommand", "imageNamePattern"];
const EDITABLE_AGENT_FIELDS: EditableAgentField[] = ["description", "kind", "model", "sandbox", "maxIterations", "branch"];
const RUNS_DIR = `${CONFIG_DIR}/runs`;
const PLANS_DIR = `${CONFIG_DIR}/plans`;
const LOGS_DIR = `${CONFIG_DIR}/logs`;
const DEFAULT_STEP_PROMPT = "$INPUT";
const PIPELINE_RUNS_DIR = RUNS_DIR;
const DIRECT_ROLE_RUN_KIND = "direct-role";
const PIPELINE_RUN_KIND = "pipeline";
const EDITOR_PREF_PATH = `${CONFIG_DIR}/editor`;
const SCAFFOLD_STATE_PATH = `${CONFIG_DIR}/scaffold-state.json`;
const CONFIG_SCHEMA_PATH = new URL("./schema/config.schema.json", import.meta.url);
const inFlightImageBuilds = new Map<string, Promise<void>>();


const RUNNER_VERSION = "agent-workflows-runner-v10";
const RUNNER = String.raw`#!/usr/bin/env node
// agent-workflows-runner-v10
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

const jobPath = process.argv[2];
if (!jobPath) throw new Error("Usage: node run-job.mjs <job.json>");
const job = JSON.parse(readFileSync(jobPath, "utf8"));

function emit(event) {
  console.log(JSON.stringify({ source: "agent-workflows", ...event }));
}

function shellEscape(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function sandboxOptions(imageName, hostPiAgentDir, hostPiFileMounts) {
  const options = imageName ? { imageName } : {};
  if (hostPiAgentDir) {
    options.mounts = [
      { hostPath: hostPiAgentDir, sandboxPath: "/home/agent/.pi-host-agent", readonly: false },
      ...(hostPiFileMounts || []),
    ];
    options.env = {
      PI_CODING_AGENT_DIR: "/home/agent/.pi-host-agent",
      PI_CODING_AGENT_SESSION_DIR: "/home/agent/.pi-host-agent/sessions",
    };
  }
  return Object.keys(options).length ? options : undefined;
}

function readHostPiDefaults() {
  const root = process.env.PI_CODING_AGENT_DIR || process.env.PI_HOST_AGENT_DIR || (process.env.HOME ? process.env.HOME + "/.pi/agent" : "");
  if (!root) return {};
  try {
    const settings = JSON.parse(readFileSync(root + "/settings.json", "utf8"));
    return {
      provider: typeof settings.defaultProvider === "string" ? settings.defaultProvider : undefined,
      model: typeof settings.defaultModel === "string" ? settings.defaultModel : undefined,
      thinking: typeof settings.defaultThinkingLevel === "string" ? settings.defaultThinkingLevel : undefined,
    };
  } catch {
    return {};
  }
}

function piWithHostDefault(model, piFactory) {
  const host = readHostPiDefaults();
  const explicitModel = model && model !== "Agent Default";
  const effectiveModel = explicitModel ? model : host.model;
  const base = piFactory(effectiveModel || "Agent Default", { captureSessions: false });
  const nonCapturing = { ...base, captureSessions: false, sessionStorage: undefined };
  if (explicitModel) return nonCapturing;
  return {
    ...nonCapturing,
    buildPrintCommand({ prompt, resumeSession }) {
      const sessionFlag = resumeSession ? " --session " + shellEscape(resumeSession) : "";
      const providerFlag = host.provider ? " --provider " + shellEscape(host.provider) : "";
      const modelFlag = effectiveModel ? " --model " + shellEscape(effectiveModel) : "";
      const thinkingFlag = host.thinking ? " --thinking " + shellEscape(host.thinking) : "";
      return { command: "pi -p --mode json --no-session" + providerFlag + modelFlag + thinkingFlag + sessionFlag, stdin: prompt };
    },
    buildInteractiveArgs({ prompt }) {
      const args = ["pi", "--no-session"];
      if (host.provider) args.push("--provider", host.provider);
      if (effectiveModel) args.push("--model", effectiveModel);
      if (host.thinking) args.push("--thinking", host.thinking);
      if (prompt) args.push(prompt);
      return args;
    },
  };
}

function stripPromiseComplete(text) {
  return String(text || "").replace(/<promise>COMPLETE<\/promise>/g, "").trim();
}

function compactText(text, max = 240) {
  const compact = stripPromiseComplete(text).replace(/\s+/g, " ").trim();
  return compact.length > max ? compact.slice(0, max - 1) + "…" : compact;
}

function summarizePiContent(content) {
  if (!Array.isArray(content)) return undefined;
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "thinking") {
      const summaries = Array.isArray(block.thinkingSignature?.summary)
        ? block.thinkingSignature.summary.map((entry) => entry?.text).filter(Boolean)
        : [];
      parts.push(compactText(summaries.join("; ") || block.thinking, 180));
    } else if (block.type === "text") {
      parts.push(compactText(block.text, 320));
    } else if (block.type === "toolCall") {
      parts.push("tool: " + (block.name || block.toolName || "tool"));
    } else if (block.type === "toolResult") {
      parts.push("tool result: " + (block.toolName || block.name || "tool"));
    }
  }
  return parts.filter(Boolean).join(" | ");
}

function assistantTextFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block && typeof block === "object" && block.type === "text" && typeof block.text === "string")
    .map((block) => stripPromiseComplete(block.text))
    .filter(Boolean);
}

function assistantTextsFromPiJsonLine(line) {
  const text = String(line || "").trim();
  if (!text.startsWith("{")) return [];
  try {
    const event = JSON.parse(text);
    if ((event.type === "message" || event.type === "turn_end") && event.message?.role === "assistant") return assistantTextFromContent(event.message.content);
    if (event.type === "agent_end" && Array.isArray(event.messages)) return event.messages.flatMap((message) => message?.role === "assistant" ? assistantTextFromContent(message.content) : []);
  } catch {}
  return [];
}

function summarizePiJsonLine(line) {
  const text = String(line || "").trim();
  if (!text.startsWith("{")) return compactText(text);
  try {
    const event = JSON.parse(text);
    if (event.type === "session") return "pi session started: " + (event.id || "unknown");
    if (event.type === "error") return "pi error: " + compactText(event.error || event.message || text);
    if ((event.type === "message_start" || event.type === "message_started") && !event.message && !event.role && !event.messageId && !event.id) return undefined;
    if (event.type === "message_start" || event.type === "message_started") {
      const role = event.message?.role || event.role || "message";
      const id = event.message?.id || event.messageId || event.id;
      return id ? role + " message started: " + id : role + " message started";
    }
    if (event.type === "message_update" || event.type === "message_updated") {
      const role = event.message?.role || event.role || "message";
      const summary = summarizePiContent(event.message?.content)
        || summarizePiContent(event.delta?.content)
        || compactText(event.text || event.delta?.text || event.content || event.message?.text || "", 320);
      return summary ? role + " update: " + summary : undefined;
    }
    if (event.type === "message" && event.message) {
      const summary = summarizePiContent(event.message.content);
      return summary ? (event.message.role || "message") + ": " + summary : "pi message: " + (event.message.role || "unknown");
    }
    if (event.type === "turn_end" && event.message) {
      const summary = summarizePiContent(event.message.content);
      return summary ? "assistant: " + summary : "pi turn complete";
    }
    if (event.type === "agent_end") return "pi agent finished" + (Array.isArray(event.messages) ? " (" + event.messages.length + " messages)" : "");
    if (event.type === "tool_call") return "tool: " + (event.name || event.toolName || "tool");
    if (event.type === "tool_result") return "tool result: " + (event.toolName || event.name || "tool");
    return undefined;
  } catch {
    return undefined;
  }
}

function parseJsonObjectFromText(text) {
  const cleaned = stripPromiseComplete(text);
  const fenceMarker = String.fromCharCode(96, 96, 96);
  const fenceStart = cleaned.indexOf(fenceMarker);
  const fenceEnd = fenceStart >= 0 ? cleaned.indexOf(fenceMarker, fenceStart + fenceMarker.length) : -1;
  const fenced = fenceStart >= 0 && fenceEnd > fenceStart ? cleaned.slice(fenceStart + fenceMarker.length, fenceEnd).replace(/^json\s*/i, "") : "";
  const candidates = fenced ? [fenced, cleaned] : [cleaned];
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let index = start; index < candidate.length; index += 1) {
      const char = candidate[index];
      if (inString) {
        if (escape) escape = false;
        else if (char === "\\") escape = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const jsonText = candidate.slice(start, index + 1);
          try { return JSON.parse(jsonText); } catch { break; }
        }
      }
    }
  }
  return undefined;
}

function extractPlanObject(assistantTexts, stdout) {
  const sources = [...assistantTexts].reverse();
  if (stdout) {
    const stdoutAssistantTexts = String(stdout).split("\n").flatMap((line) => assistantTextsFromPiJsonLine(line));
    sources.push(...stdoutAssistantTexts.reverse());
    sources.push(stdout);
  }
  for (const source of sources) {
    const parsed = parseJsonObjectFromText(source);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  return undefined;
}

async function loadSandbox(kind, imageName, _hostPiConfig, hostPiAgentDir, hostPiFileMounts) {
  if (kind === "podman") return (await import("@ai-hero/sandcastle/sandboxes/podman")).podman(sandboxOptions(imageName, hostPiAgentDir, hostPiFileMounts));
  if (kind === "vercel") return (await import("@ai-hero/sandcastle/sandboxes/vercel")).vercel();
  if (kind === "no-sandbox") return (await import("@ai-hero/sandcastle/sandboxes/no-sandbox")).noSandbox();
  return (await import("@ai-hero/sandcastle/sandboxes/docker")).docker(sandboxOptions(imageName, hostPiAgentDir, hostPiFileMounts));
}

try {
  const { run, claudeCode, codex, cursor, opencode, copilot, pi } = await import("@ai-hero/sandcastle");
  const sandbox = await loadSandbox(job.sandbox || "docker", job.imageName, job.hostPiConfig, job.hostPiAgentDir, job.hostPiFileMounts);
  const makeAgent = (provider, model) => {
    if (provider === "claude") return claudeCode(model);
    if (provider === "codex") return codex(model);
    if (provider === "cursor") return cursor(model);
    if (provider === "opencode") return opencode(model);
    if (provider === "copilot") return copilot(model);
    return piWithHostDefault(model, pi);
  };
  const prompt = (job.systemPrompt ? job.systemPrompt + "\n\n" : "") + "## Delegated task\n\n" + job.prompt;
  const logPath = job.logPath;
  const resultPath = job.resultPath;
  mkdirSync(dirname(logPath), { recursive: true });
  mkdirSync(dirname(resultPath), { recursive: true });

  const assistantTexts = [];
  emit({ type: "start", id: job.id, agent: job.agent, sandbox: job.sandbox, model: job.model });
  const result = await run({
    name: job.name || job.id,
    cwd: job.cwd,
    agent: makeAgent(job.provider || "pi", job.model),
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
        if (event.type === "text") {
          const text = event.text || event.chunk || "";
          assistantTexts.push(...assistantTextsFromPiJsonLine(text));
          const summary = summarizePiJsonLine(text);
          if (summary) emit({ type: "text", id: job.id, text: summary });
        }
        else if (event.type === "toolCall") emit({ type: "tool", id: job.id, tool: event.name || event.toolName || "tool" });
        else if (event.type === "raw") {
          const text = event.text || event.line || "";
          assistantTexts.push(...assistantTextsFromPiJsonLine(text));
          const summary = summarizePiJsonLine(text);
          if (summary) emit({ type: "text", id: job.id, text: summary });
        }
      },
    },
  });

  if (job.outputKind === "work-plan") {
    const plan = extractPlanObject(assistantTexts, result.stdout);
    if (!plan) {
      const message = "Planner completed but no authoritative Work Plan JSON object could be extracted from assistant output.";
      writeFileSync(resultPath, JSON.stringify({ id: job.id, agent: job.agent, error: message, logPath }, null, 2));
      emit({ type: "error", id: job.id, error: message });
      process.exitCode = 1;
    } else {
      writeFileSync(resultPath, JSON.stringify(plan, null, 2));
      emit({ type: "done", id: job.id, branch: result.branch, commits: (result.commits || []).map((c) => c.sha || c), resultPath });
    }
  } else {
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
  }
} catch (error) {
  const message = error && error.stack ? error.stack : String(error);
  if (job?.resultPath) writeFileSync(job.resultPath, JSON.stringify({ id: job.id, agent: job.agent, error: message }, null, 2));
  emit({ type: "error", id: job?.id, error: message });
  process.exitCode = 1;
} finally {
  if (job?.hostPiAgentDir) rmSync(job.hostPiAgentDir, { recursive: true, force: true });
}
`;

const LEGACY_SAMPLE_CONFIG = `# Agent Workflows delegation config.
# Mirrors the out-of-the-box @ai-hero/sandcastle templates.
# Install runtime once with: npm install --save-dev @ai-hero/sandcastle
# Optional first-time Sandcastle setup: npx @ai-hero/sandcastle init

defaultSandbox: docker
defaultModel: Agent Default
defaultPipeline: simple-loop
defaultAgent: claude-code
maxWorkers: 5
maxIterations: 10
workSource: github-issues
# Optional command to configure a custom Work Source after Sandcastle init.
# workSourceSetupCommand: pi "$(cat .sandcastle/SETUP_ISSUE_TRACKER.md)"
imageNamePattern: sandcastle:<repo-dir-name>

agents:
  planner:
    description: Deep-reasoning planner for dependency analysis and work selection.
    model: claude-opus-4-8
    sandbox: docker
    maxIterations: 1
    systemPrompt: |
      You are the Sandcastle planner agent.
  worker:
    description: Simple-loop worker that picks and closes one open task at a time.
    model: claude-sonnet-4-6
    sandbox: docker
    maxIterations: 3
    systemPrompt: |
      You are the Sandcastle worker agent.
  implementer:
    description: Implementation agent for a selected task or branch.
    model: claude-sonnet-4-6
    sandbox: docker
    maxIterations: 100
    systemPrompt: |
      You are the Sandcastle implementer agent.
  reviewer:
    description: Reviewer for branch diffs, correctness, tests, and merge blockers.
    model: claude-sonnet-4-6
    sandbox: docker
    maxIterations: 1
    systemPrompt: |
      You are the Sandcastle reviewer agent.
  merger:
    description: Merger that combines completed branches and resolves conflicts.
    model: claude-sonnet-4-6
    sandbox: docker
    maxIterations: 1
    systemPrompt: |
      You are the Sandcastle merger agent.


pipelines:
  simple-loop:
    description: Sandcastle simple-loop template: one worker picks open issues and closes them.
    branchStrategy:
      type: merge-to-head
    sandbox: docker
    model: claude-sonnet-4-6
    copyToWorktree: [node_modules]
    steps:
      - role: worker
        prompt: |
          # Context
          
          ## Open issues
          
          !\`{{LIST_TASKS_COMMAND}}\`
          
          The list above has already been filtered to issues ready for work and is the sole source of truth for what work exists. Do not run your own unfiltered query to find more issues — if the list is empty, there is nothing to do.
          
          ## Recent RALPH commits (last 10)
          
          !\`git log --oneline --grep="RALPH" -10\`
          
          # Task
          
          You are RALPH — an autonomous coding agent working through issues one at a time.
          
          ## Priority order
          
          Work on issues in this order:
          
          1. **Bug fixes** — broken behaviour affecting users
          2. **Tracer bullets** — thin end-to-end slices that prove an approach works
          3. **Polish** — improving existing functionality (error messages, UX, docs)
          4. **Refactors** — internal cleanups with no user-visible change
          
          Pick the highest-priority open issue that is not blocked by another open issue.
          
          ## Workflow
          
          1. **Explore** — read the issue carefully. Pull in the parent PRD if referenced. Read the relevant source files and tests before writing any code.
          2. **Plan** — decide what to change and why. Keep the change as small as possible.
          3. **Execute** — use RGR (Red → Green → Repeat → Refactor): write a failing test first, then write the implementation to pass it.
          4. **Verify** — run \`npm run typecheck\` and \`npm run test\` before committing. Fix any failures before proceeding.
          5. **Commit** — make a single git commit. The message MUST:
             - Start with \`RALPH:\` prefix
             - Include the task completed and any PRD reference
             - List key decisions made
             - List files changed
             - Note any blockers for the next iteration
          6. **Close** — close the issue with \`{{CLOSE_TASK_COMMAND}}\` explaining what was done.
          
          ## Rules
          
          - Work on **one issue per iteration**. Do not attempt multiple issues in a single iteration.
          - Do not close an issue until you have committed the fix and verified tests pass.
          - Do not leave commented-out code or TODO comments in committed code.
          - If you are blocked (missing context, failing tests you cannot fix, external dependency), leave a comment on the issue and move on — do not close it.
          
          # Done
          
          When all actionable issues are complete (or you are blocked on all remaining ones), or the open-issues block at the top of this prompt is empty, output the completion signal:
          
          <promise>COMPLETE</promise>
        maxIterations: 3

  sequential-reviewer:
    description: Sandcastle sequential-reviewer template: implement one issue, then review the branch.
    branchStrategy:
      type: branch
      branch: sandcastle/sequential-reviewer
    sandbox: docker
    model: claude-sonnet-4-6
    copyToWorktree: [node_modules]
    steps:
      - role: implementer
        prompt: |
          # Context
          
          ## Open issues
          
          !\`{{LIST_TASKS_COMMAND}}\`
          
          The list above has already been filtered to issues ready for work and is the sole source of truth for what work exists. Do not run your own unfiltered query to find more issues — if the list is empty, there is nothing to do.
          
          ## Recent RALPH commits (last 10)
          
          !\`git log --oneline --grep="RALPH" -10\`
          
          # Task
          
          You are RALPH — an autonomous coding agent working through issues one at a time.
          
          ## Priority order
          
          Work on issues in this order:
          
          1. **Bug fixes** — broken behaviour affecting users
          2. **Tracer bullets** — thin end-to-end slices that prove an approach works
          3. **Polish** — improving existing functionality (error messages, UX, docs)
          4. **Refactors** — internal cleanups with no user-visible change
          
          Pick the highest-priority open issue that is not blocked by another open issue.
          
          ## Workflow
          
          1. **Explore** — read the issue carefully. Pull in the parent PRD if referenced. Read the relevant source files and tests before writing any code.
          2. **Plan** — decide what to change and why. Keep the change as small as possible.
          3. **Execute** — use RGR (Red → Green → Repeat → Refactor): write a failing test first, then write the implementation to pass it.
          4. **Verify** — run \`npm run typecheck\` and \`npm run test\` before committing. Fix any failures before proceeding.
          5. **Commit** — make a single git commit. The message MUST:
             - Start with \`RALPH:\` prefix
             - Include the task completed and any PRD reference
             - List key decisions made
             - List files changed
             - Note any blockers for the next iteration
          6. **Close** — close the issue with \`{{CLOSE_TASK_COMMAND}}\` explaining what was done.
          
          ## Rules
          
          - Work on **one issue per iteration**. Do not attempt multiple issues in a single iteration.
          - Do not close an issue until you have committed the fix and verified tests pass.
          - Do not leave commented-out code or TODO comments in committed code.
          - If you are blocked (missing context, failing tests you cannot fix, external dependency), leave a comment on the issue and move on — do not close it.
          
          # Done
          
          When all actionable issues are complete (or you are blocked on all remaining ones), or the open-issues block at the top of this prompt is empty, output the completion signal:
          
          <promise>COMPLETE</promise>
        maxIterations: 1
      - role: reviewer
        prompt: |
          # TASK
          
          Review the code changes on branch \`{{BRANCH}}\` and improve code clarity, consistency, and maintainability while preserving exact functionality.
          
          # CONTEXT
          
          ## Branch diff
          
          !\`git diff {{TARGET_BRANCH}}...{{BRANCH}}\`
          
          ## Commits on this branch
          
          !\`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline\`
          
          # REVIEW PROCESS
          
          1. **Understand the change**: Read the diff and commits above to understand the intent.
          
          2. **Analyze for improvements**: Look for opportunities to:
             - Reduce unnecessary complexity and nesting
             - Eliminate redundant code and abstractions
             - Improve readability through clear variable and function names
             - Consolidate related logic
             - Remove unnecessary comments that describe obvious code
             - Avoid nested ternary operators - prefer switch statements or if/else chains
             - Choose clarity over brevity - explicit code is often better than overly compact code
          
          3. **Check correctness**:
             - Does the implementation match the intent? Are edge cases handled?
             - Are new/changed behaviours covered by tests?
             - Are there unsafe casts, \`any\` types, or unchecked assumptions?
             - Does the change introduce injection vulnerabilities, credential leaks, or other security issues?
          
          4. **Maintain balance**: Avoid over-simplification that could:
             - Reduce code clarity or maintainability
             - Create overly clever solutions that are hard to understand
             - Combine too many concerns into single functions or components
             - Remove helpful abstractions that improve code organization
             - Make the code harder to debug or extend
          
          5. **Apply project standards**: Follow the coding standards defined in @.sandcastle/CODING_STANDARDS.md
          
          6. **Preserve functionality**: Never change what the code does - only how it does it. All original features, outputs, and behaviors must remain intact.
          
          # EXECUTION
          
          If you find improvements to make:
          
          1. Make the changes directly on this branch
          2. Run tests and type checking to ensure nothing is broken
          3. Commit describing the refinements
          
          If the code is already clean and well-structured, do nothing.
          
          Once complete, output <promise>COMPLETE</promise>.
        maxIterations: 1

  parallel-planner:
    description: Sandcastle parallel-planner template: plan unblocked work, implement branches, then merge.
    branchStrategy:
      type: branch
      branch: sandcastle/parallel-planner
    sandbox: docker
    model: claude-sonnet-4-6
    copyToWorktree: [node_modules]
    steps:
      - role: planner
        prompt: |
          # ISSUES
          
          Here are the open issues in the repo:
          
          <issues-json>
          
          !\`{{LIST_TASKS_COMMAND}}\`
          
          </issues-json>
          
          The list above has already been filtered to issues ready for work.
          
          # TASK
          
          Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.
          
          An issue B is **blocked by** issue A if:
          
          - B requires code or infrastructure that A introduces
          - B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
          - B's requirements depend on a decision or API shape that A will establish
          
          An issue is **unblocked** if it has zero blocking dependencies on other open issues.
          
          For each unblocked issue, assign a branch name using the exact format \`sandcastle/issue-{id}\` (no slug or other suffix). This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved.
          
          # OUTPUT
          
          Output your plan as a JSON object wrapped in \`<plan>\` tags:
          
          <plan>
          {"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42"}]}
          </plan>
          
          Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).
          
          Always emit the \`<plan>\` tags, even when there is nothing to do. If there are no issues to work on at all, output \`<plan>{"issues": []}</plan>\` so the run can exit cleanly.
        maxIterations: 1
      - role: implementer
        prompt: |
          # TASK
          
          Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}
          
          Pull in the issue using \`{{VIEW_TASK_COMMAND}}\`. If it has a parent PRD, pull that in too.
          
          Only work on the issue specified.
          
          Work on branch {{BRANCH}}. Make commits and run tests.
          
          # CONTEXT
          
          Here are the last 10 commits:
          
          <recent-commits>
          
          !\`git log -n 10 --format="%H%n%ad%n%B---" --date=short\`
          
          </recent-commits>
          
          # EXPLORATION
          
          Explore the repo and fill your context window with relevant information that will allow you to complete the task.
          
          Pay extra attention to test files that touch the relevant parts of the code.
          
          # EXECUTION
          
          If applicable, use RGR to complete the task.
          
          1. RED: write one test
          2. GREEN: write the implementation to pass that test
          3. REPEAT until done
          4. REFACTOR the code
          
          # FEEDBACK LOOPS
          
          Before committing, run \`npm run typecheck\` and \`npm run test\` to ensure the tests pass.
          
          # COMMIT
          
          Make a git commit. The commit message must:
          
          1. Start with \`RALPH:\` prefix
          2. Include task completed + PRD reference
          3. Key decisions made
          4. Files changed
          5. Blockers or notes for next iteration
          
          Keep it concise.
          
          # THE ISSUE
          
          If the task is not complete, leave a comment on the issue with what was done.
          
          Do not close the issue - this will be done later.
          
          Once complete, output <promise>COMPLETE</promise>.
          
          # FINAL RULES
          
          ONLY WORK ON A SINGLE TASK.
        maxIterations: 100
      - role: merger
        prompt: |
          # TASK
          
          Merge the following branches into the current branch:
          
          {{BRANCHES}}
          
          For each branch:
          
          1. Run \`git merge <branch> --no-edit\`
          2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
          3. After resolving conflicts, run \`npm run typecheck\` and \`npm run test\` to verify everything works
          4. If tests fail, fix the issues before proceeding to the next branch
          
          After all branches are merged, make a single commit summarizing the merge.
          
          # CLOSE ISSUES
          
          For each branch that was merged, close its issue using the following command:
          
          \`{{CLOSE_TASK_COMMAND}}\`
          
          Here are all the issues:
          
          {{ISSUES}}
          
          Once you've merged everything you can, output <promise>COMPLETE</promise>.
        maxIterations: 1

  parallel-planner-with-review:
    description: Sandcastle parallel-planner-with-review template: plan, implement, review, then merge.
    branchStrategy:
      type: branch
      branch: sandcastle/parallel-planner-with-review
    sandbox: docker
    model: claude-sonnet-4-6
    copyToWorktree: [node_modules]
    steps:
      - role: planner
        prompt: |
          # ISSUES
          
          Here are the open issues in the repo:
          
          <issues-json>
          
          !\`{{LIST_TASKS_COMMAND}}\`
          
          </issues-json>
          
          The list above has already been filtered to issues ready for work.
          
          # TASK
          
          Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.
          
          An issue B is **blocked by** issue A if:
          
          - B requires code or infrastructure that A introduces
          - B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
          - B's requirements depend on a decision or API shape that A will establish
          
          An issue is **unblocked** if it has zero blocking dependencies on other open issues.
          
          For each unblocked issue, assign a branch name using the exact format \`sandcastle/issue-{id}\` (no slug or other suffix). This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved.
          
          # OUTPUT
          
          Output your plan as a JSON object wrapped in \`<plan>\` tags:
          
          <plan>
          {"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42"}]}
          </plan>
          
          Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).
          
          Always emit the \`<plan>\` tags, even when there is nothing to do. If there are no issues to work on at all, output \`<plan>{"issues": []}</plan>\` so the run can exit cleanly.
        maxIterations: 1
      - role: implementer
        prompt: |
          # TASK
          
          Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}
          
          Pull in the issue using \`{{VIEW_TASK_COMMAND}}\`. If it has a parent PRD, pull that in too.
          
          Only work on the issue specified.
          
          Work on branch {{BRANCH}}. Make commits and run tests.
          
          # CONTEXT
          
          Here are the last 10 commits:
          
          <recent-commits>
          
          !\`git log -n 10 --format="%H%n%ad%n%B---" --date=short\`
          
          </recent-commits>
          
          # EXPLORATION
          
          Explore the repo and fill your context window with relevant information that will allow you to complete the task.
          
          Pay extra attention to test files that touch the relevant parts of the code.
          
          # EXECUTION
          
          If applicable, use RGR to complete the task.
          
          1. RED: write one test
          2. GREEN: write the implementation to pass that test
          3. REPEAT until done
          4. REFACTOR the code
          
          # FEEDBACK LOOPS
          
          Before committing, run \`npm run typecheck\` and \`npm run test\` to ensure the tests pass.
          
          # COMMIT
          
          Make a git commit. The commit message must:
          
          1. Start with \`RALPH:\` prefix
          2. Include task completed + PRD reference
          3. Key decisions made
          4. Files changed
          5. Blockers or notes for next iteration
          
          Keep it concise.
          
          # THE ISSUE
          
          If the task is not complete, leave a comment on the issue with what was done.
          
          Do not close the issue - this will be done later.
          
          Once complete, output <promise>COMPLETE</promise>.
          
          # FINAL RULES
          
          ONLY WORK ON A SINGLE TASK.
        maxIterations: 100
      - role: reviewer
        prompt: |
          # TASK
          
          Review the code changes on branch \`{{BRANCH}}\` and improve code clarity, consistency, and maintainability while preserving exact functionality.
          
          # CONTEXT
          
          ## Branch diff
          
          !\`git diff {{TARGET_BRANCH}}...{{BRANCH}}\`
          
          ## Commits on this branch
          
          !\`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline\`
          
          # REVIEW PROCESS
          
          1. **Understand the change**: Read the diff and commits above to understand the intent.
          
          2. **Analyze for improvements**: Look for opportunities to:
             - Reduce unnecessary complexity and nesting
             - Eliminate redundant code and abstractions
             - Improve readability through clear variable and function names
             - Consolidate related logic
             - Remove unnecessary comments that describe obvious code
             - Avoid nested ternary operators - prefer switch statements or if/else chains
             - Choose clarity over brevity - explicit code is often better than overly compact code
          
          3. **Check correctness**:
             - Does the implementation match the intent? Are edge cases handled?
             - Are new/changed behaviours covered by tests?
             - Are there unsafe casts, \`any\` types, or unchecked assumptions?
             - Does the change introduce injection vulnerabilities, credential leaks, or other security issues?
          
          4. **Maintain balance**: Avoid over-simplification that could:
             - Reduce code clarity or maintainability
             - Create overly clever solutions that are hard to understand
             - Combine too many concerns into single functions or components
             - Remove helpful abstractions that improve code organization
             - Make the code harder to debug or extend
          
          5. **Apply project standards**: Follow the coding standards defined in @.sandcastle/CODING_STANDARDS.md
          
          6. **Preserve functionality**: Never change what the code does - only how it does it. All original features, outputs, and behaviors must remain intact.
          
          # EXECUTION
          
          If you find improvements to make:
          
          1. Make the changes directly on this branch
          2. Run tests and type checking to ensure nothing is broken
          3. Commit describing the refinements
          
          If the code is already clean and well-structured, do nothing.
          
          Once complete, output <promise>COMPLETE</promise>.
        maxIterations: 1
      - role: merger
        prompt: |
          # TASK
          
          Merge the following branches into the current branch:
          
          {{BRANCHES}}
          
          For each branch:
          
          1. Run \`git merge <branch> --no-edit\`
          2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
          3. After resolving conflicts, run \`npm run typecheck\` and \`npm run test\` to verify everything works
          4. If tests fail, fix the issues before proceeding to the next branch
          
          After all branches are merged, make a single commit summarizing the merge.
          
          # CLOSE ISSUES
          
          For each branch that was merged, close its issue using the following command:
          
          \`{{CLOSE_TASK_COMMAND}}\`
          
          Here are all the issues:
          
          {{ISSUES}}
          
          Once you've merged everything you can, output <promise>COMPLETE</promise>.
        maxIterations: 1

  archive:
    description: Doc-Vader archive helper for terminal-state backlog reconciliation.
    branchStrategy:
      type: branch
      branch: sandcastle/archive
    sandbox: docker
    model: claude-sonnet-4-6
    steps:
      - role: reviewer
        prompt: |
          Inspect terminal-state backlog work and identify safe archive/reconciliation actions.

$INPUT
        maxIterations: 1
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

export function parseBacklogProcessArgs(raw: string): { query: string; pipeline?: string; planId?: string } {
	const tokens = tokenizeCommandArgs(raw);
	const queryTokens: string[] = [];
	let pipeline: string | undefined;
	let planId: string | undefined;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token === "--pipeline" || token === "-p") {
			const value = tokens[i + 1];
			if (!value || value.startsWith("-")) {
				throw new Error(`Missing value for ${token}. Use /work:process <query> --pipeline <pipeline>.`);
			}
			pipeline = value;
			i++;
			continue;
		}
		if (token.startsWith("--pipeline=")) {
			pipeline = token.slice("--pipeline=".length);
			if (!pipeline) {
				throw new Error("Missing value for --pipeline. Use /work:process <query> --pipeline <pipeline>.");
			}
			continue;
		}
		if (token.startsWith("-p=")) {
			pipeline = token.slice(3);
			if (!pipeline) {
				throw new Error("Missing value for -p. Use /work:process <query> -p <pipeline>.");
			}
			continue;
		}
		if (token === "--plan") {
			const value = tokens[i + 1];
			if (!value || value.startsWith("-")) throw new Error("Missing value for --plan. Use /work:process --plan <plan-id>.");
			planId = value;
			i++;
			continue;
		}
		if (token.startsWith("--plan=")) {
			planId = token.slice("--plan=".length);
			if (!planId) throw new Error("Missing value for --plan. Use /work:process --plan <plan-id>.");
			continue;
		}
		queryTokens.push(token);
	}

	return { query: queryTokens.join(" ").trim(), pipeline, planId };
}

function getBacklogTimestamp(now?: () => number): number {
	return now?.() ?? Date.now();
}

function createBacklogRunId(startedAt: number): string {
	return `backlog-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBacklogPlanId(createdAt: number): string {
	return `plan-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function validateSandcastleWorkspaceSource(cwd: string): string[] {
	const repo = spawnSync("git", ["rev-parse", "--git-dir"], { cwd, encoding: "utf8" });
	if (repo.status !== 0) return ["Repository is not a git repository. Sandcastle workspaces require a git repository before any role can run."];
	const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd, encoding: "utf8" });
	if (head.status !== 0) return ["Repository has no HEAD commit. Sandcastle workspaces require at least one commit before any role can run; create an initial commit, then retry."];
	return [];
}

function assertSandcastleWorkspaceSource(cwd: string): void {
	const issues = validateSandcastleWorkspaceSource(cwd);
	if (issues.length) throw new Error(issues.join("\n"));
}

function createInvalidBacklogPlanId(createdAt: number): string {
	return `invalid-plan-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeBacklogPlanRecord(cwd: string, record: any): string {
	mkdirSync(join(cwd, PLANS_DIR), { recursive: true });
	const recordPath = join(cwd, PLANS_DIR, `${record.id}.json`);
	writeFileSync(recordPath, JSON.stringify(record, null, 2));
	return recordPath;
}

function readBacklogPlanRecord(cwd: string, planId: string): any {
	const path = join(cwd, PLANS_DIR, `${planId}.json`);
	if (!existsSync(path)) throw new Error(`Unknown Work Plan '${planId}'.`);
	const record = JSON.parse(readFileSync(path, "utf8"));
	if (record.kind !== "work-plan") {
		const reason = Array.isArray(record.validationErrors) && record.validationErrors.length ? ` Validation errors: ${record.validationErrors.join("; ")}.` : "";
		throw new Error(`Cached plan '${planId}' is not an executable Work Plan.${reason}`);
	}
	return record;
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
		.map((part) => part.replace(/^-+\s*/, "").trim().replace(/^['"]|['"]$/g, ""))
		.filter(Boolean);
}

function splitMarkdownFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
	const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return { frontmatter: {}, body: text };
	return { frontmatter: readFrontmatter(text), body: text.slice(match[0].length) };
}

function parseNestedFrontmatterList(raw: string | undefined, key: string): string[] {
	if (!raw) return [];
	const values: string[] = [];
	let active = false;
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (keyMatch) {
			active = keyMatch[1] === key;
			if (active && keyMatch[2]) values.push(keyMatch[2].replace(/^['"]|['"]$/g, ""));
			continue;
		}
		if (active && trimmed.startsWith("- ")) values.push(trimmed.slice(2).trim().replace(/^['"]|['"]$/g, ""));
	}
	return values.filter(Boolean);
}

function captureMarkdownSection(body: string, heading: string): string {
	const pattern = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |\\s*$)`, "m");
	return body.match(pattern)?.[1]?.trim() || "";
}

function captureChecklistItems(sectionText: string): string[] {
	return sectionText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^- \[[ x]\] /.test(line))
		.map((line) => line.replace(/^- \[[ x]\] /, ""));
}

function readWorkItems(cwd: string): WorkItem[] {
	const backlogDir = join(cwd, "backlog");
	if (!existsSync(backlogDir)) return [];
	return readdirSync(backlogDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => {
			const absolutePath = join(backlogDir, entry.name);
			const sourcePath = `backlog/${entry.name}`;
			const text = readFileSync(absolutePath, "utf8");
			const { frontmatter, body } = splitMarkdownFrontmatter(text);
			const title = frontmatter.title || entry.name.replace(/^\d+-/, "").replace(/\.md$/, "");
			const summary = frontmatter.summary || captureMarkdownSection(body, "Goal") || captureMarkdownSection(body, "Background") || undefined;
			const tags = parseFrontmatterList(frontmatter.tags);
			const dependencies = parseNestedFrontmatterList(frontmatter.links, "depends_on");
			const acceptanceCriteria = captureChecklistItems(captureMarkdownSection(body, "Acceptance Criteria"));
			const id = frontmatter.id || entry.name.slice(0, 5);
			const estimate = Number(frontmatter.estimated || 0);
			return {
				id,
				title,
				summary,
				body,
				tags,
				source: {
					adapter: "local-markdown",
					kind: "markdown-file",
					id,
					path: sourcePath,
					absolutePath,
					body,
					payload: { frontmatter },
					raw: text,
				},
				sourcePath,
				dependencies,
				dependsOn: dependencies,
				acceptanceCriteria,
				estimate,
				estimated: estimate,
			};
		})
		.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
}

const readBacklogItems = readWorkItems;

const SAMPLE_CONFIG = configToYaml(packsToConfig());

function matchesWorkQuery(item: WorkItem, query: string): boolean {
	const raw = query.trim().toLowerCase();
	if (!raw) return true;
	const source = item.source || {};
	const haystack = [item.id, item.title, item.summary || "", item.sourcePath, source.path || "", source.url || "", source.id || "", source.body || "", ...item.tags].join(" ").toLowerCase();
	const tokens = raw.split(/\s+/).filter(Boolean);
	return tokens.every((token) => haystack.includes(token));
}

const matchesBacklogQuery = matchesWorkQuery;

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
		? "The first recommended iteration contains independent Work Items that can run in parallel."
		: "The first recommended iteration focuses on the best matching Work Item.";
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

function hydrateConfigDefaults(raw: string): { text: string; changed: boolean; changes: string[] } {
	let text = raw;
	const changes: string[] = [];
	for (const [key, value] of Object.entries({ defaultPipeline: "simple-loop", defaultAgent: "claude-code", maxWorkers: 5, maxIterations: 10, workSource: "github-issues" })) {
		if (!new RegExp(`^${key}:`, "m").test(text)) {
			text = setConfigValueInText(text, key, value);
			changes.push(`added ${key}`);
		}
	}
	return { text, changed: text !== raw, changes };
}

function runnerNeedsRefresh(path: string): boolean {
	if (!existsSync(path)) return false;
	const text = readFileSync(path, "utf8");
	return !text.includes(RUNNER_VERSION)
		|| text.includes("importUserPackage")
		|| text.includes("PI_AGENT_NODE_MODULES")
		|| text.includes("function piWithHostDefault(model)")
		|| text.includes("const base = pi(model && model !== \"Agent Default\"");
}

function ensureScaffold(cwd: string, options: { overwrite?: boolean; hydrate?: boolean } = {}): { changes: string[]; overwritten: string[] } {
	mkdirSync(join(cwd, CONFIG_DIR), { recursive: true });
	mkdirSync(join(cwd, JOBS_DIR), { recursive: true });
	mkdirSync(join(cwd, RESULTS_DIR), { recursive: true });
	mkdirSync(join(cwd, PIPELINE_RUNS_DIR), { recursive: true });
	const changes: string[] = [];
	const overwritten: string[] = [];
	const configPath = join(cwd, CONFIG_PATH);
	const legacyConfigPath = join(cwd, LEGACY_CONFIG_PATH);
	if (!existsSync(configPath) && existsSync(legacyConfigPath) && !options.overwrite) {
		writeFileSync(configPath, readFileSync(legacyConfigPath, "utf8"));
		changes.push(`migrated ${LEGACY_CONFIG_PATH} to ${CONFIG_PATH}`);
	}
	const hadConfig = existsSync(configPath);
	if (!hadConfig || options.overwrite) {
		if (hadConfig && options.overwrite) overwritten.push(CONFIG_PATH);
		writeFileSync(configPath, SAMPLE_CONFIG);
		changes.push(`${hadConfig && options.overwrite ? "overwrote" : "wrote"} ${CONFIG_PATH}`);
	}
	const runnerPath = join(cwd, RUNNER_PATH);
	const hadRunner = existsSync(runnerPath);
	const staleRunner = hadRunner && runnerNeedsRefresh(runnerPath);
	if (!hadRunner || options.overwrite || staleRunner) {
		if (hadRunner && options.overwrite) overwritten.push(RUNNER_PATH);
		writeFileSync(runnerPath, RUNNER);
		changes.push(`${hadRunner && options.overwrite ? "overwrote" : staleRunner ? "refreshed" : "wrote"} ${RUNNER_PATH}`);
	}
	return { changes, overwritten };
}

function configPackText(pack: string): string {
	if (pack === "default" || pack === "sandcastle-defaults") return SAMPLE_CONFIG;
	return buildDefaultConfigText({ defaultPipeline: pack });
}

function listConfigPacks(): SelectItem[] {
	return [
		{ value: "default", label: "Graph workflow defaults", description: "Out-of-the-box graph-native Agent Workflows pipelines plus archive helper" },
		{ value: "simple-loop", label: "simple-loop", description: "Worker picks and closes issues one by one" },
		{ value: "sequential-reviewer", label: "sequential-reviewer", description: "Implement then review one issue branch" },
		{ value: "parallel-planner", label: "parallel-planner", description: "Plan unblocked work, implement, merge" },
		{ value: "parallel-planner-with-review", label: "parallel-planner-with-review", description: "Plan, implement, review, merge" },
	];
}

function ensureScaffoldPath(cwd: string): string {
	ensureScaffold(cwd);
	return join(cwd, CONFIG_PATH);
}

function existingConfigPath(cwd: string): string {
	const configPath = join(cwd, CONFIG_PATH);
	if (existsSync(configPath)) return configPath;
	const legacyConfigPath = join(cwd, LEGACY_CONFIG_PATH);
	if (existsSync(legacyConfigPath)) return legacyConfigPath;
	return configPath;
}

function readConfigText(cwd: string): string {
	const configPath = ensureScaffoldPath(cwd);
	return readFileSync(configPath, "utf8");
}

function readExistingConfigText(cwd: string): string {
	return readFileSync(existingConfigPath(cwd), "utf8");
}

function writeConfigText(cwd: string, text: string): void {
	ensureScaffold(cwd);
	writeFileSync(join(cwd, CONFIG_PATH), text);
}

function getPreferredEditor(cwd: string): string {
	const editorPath = join(cwd, EDITOR_PREF_PATH);
	if (existsSync(editorPath)) {
		const configured = readFileSync(editorPath, "utf8").trim();
		if (configured) return configured;
	}
	return process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "nano");
}

function setPreferredEditor(cwd: string, editor: string): void {
	mkdirSync(join(cwd, CONFIG_DIR), { recursive: true });
	writeFileSync(join(cwd, EDITOR_PREF_PATH), `${editor.trim()}\n`);
}

function runTerminalEditor(cwd: string, filePath: string, editor?: string): number | null {
	const command = editor || getPreferredEditor(cwd);
	const shell = process.env.SHELL || "/bin/sh";
	const quotedPath = JSON.stringify(filePath);
	const result = spawnSync(shell, ["-lc", `${command} ${quotedPath}`], { cwd, stdio: "inherit", env: process.env });
	return result.status;
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

function formatYamlMapKey(value: string): string {
	return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function parseYamlMapKey(value: string): string {
	return parseScalar(value);
}

function yamlMapKeyRegex(value: string): string {
	return `(?:${escapeRegExp(value)}|${escapeRegExp(JSON.stringify(value))})`;
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

function presentModelSetting(value: unknown): unknown {
	return value === undefined || value === null || value === "" ? DEFAULT_MODEL : value;
}

function configForPresentation(cfg: SandcastleConfig): SandcastleConfig {
	return {
		...cfg,
		defaultModel: presentModelSetting(cfg.defaultModel) as string,
		agents: Object.fromEntries(Object.entries(cfg.agents).map(([name, agent]) => [name, { ...agent, model: presentModelSetting(agent.model) }])),
		pipelines: Object.fromEntries(Object.entries(cfg.pipelines).map(([name, pipeline]) => [name, {
			...pipeline,
			model: presentModelSetting(pipeline.model) as string,
			steps: (pipeline.steps || []).map((step) => ({ ...step, model: presentModelSetting(step.model) as string })),
		}])) as Record<string, PipelineDef>,
	};
}

function formatConfigValue(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

function readConfigValue(cfg: SandcastleConfig, path: string): unknown {
	const parts = splitConfigPath(path);
	if (parts.length === 1 && isRootConfigKey(parts[0])) return cfg[parts[0]];
	if (parts[0] === "roles" && parts.length === 3 && isEditableAgentField(parts[2])) {
		return cfg.agents[parts[1]]?.[parts[2]];
	}
	if (parts[0] === "pipelines" && parts.length === 3) return (cfg.pipelines[parts[1]] as any)?.[parts[2]];
	if (parts[0] === "pipelines" && parts[2] === "nodes" && parts.length >= 5) return parts.slice(2).reduce((current: any, part) => current?.[part], cfg.pipelines[parts[1]] as any);
	if (parts[0] === "pipelines" && parts[2] === "steps" && parts.length === 5) return (cfg.pipelines[parts[1]]?.steps?.[Number(parts[3])] as any)?.[parts[4]];
	if (parts[0] === "chains" && parts.length === 2) return cfg.chains[parts[1]];
	return undefined;
}

function supportedConfigPath(path: string): boolean {
	const parts = splitConfigPath(path);
	if (parts.length === 1) return isRootConfigKey(parts[0]);
	if (parts[0] === "roles" && parts.length === 3 && isEditableAgentField(parts[2])) return true;
	if (parts[0] === "pipelines" && parts.length === 3 && ["description", "model", "sandbox"].includes(parts[2])) return true;
	if (parts[0] === "pipelines" && parts[2] === "nodes" && parts.length >= 5 && ["role", "prompt", "promptOverride", "model", "sandbox", "maxIterations"].includes(parts.at(-1)!)) return true;
	if (parts[0] === "pipelines" && parts[2] === "steps" && parts.length === 5 && ["role", "prompt", "model", "sandbox", "maxIterations"].includes(parts[4])) return true;
	return false;
}

function defaultConfigValue(path: string): unknown {
	const parts = splitConfigPath(path);
	if (parts.length === 1 && isRootConfigKey(parts[0])) {
		const value = DEFAULT_CONFIG[parts[0]];
		return parts[0] === "defaultModel" ? presentModelSetting(value) : value;
	}
	if (parts[0] === "roles" && parts.length === 3 && isEditableAgentField(parts[2])) {
		const value = DEFAULT_CONFIG.agents[parts[1]]?.[parts[2]];
		return parts[2] === "model" ? presentModelSetting(value) : value;
	}
	return undefined;
}

function removeConfigValueInText(raw: string, path: string): string {
	const parts = splitConfigPath(path);
	if (parts[0] !== "roles" || parts.length !== 3) return raw;
	const [, agentName, fieldName] = parts;
	const lines = raw.replace(/\r/g, "").split("\n");
	const agentHeader = new RegExp(`^  ${escapeRegExp(agentName)}:\\s*$`);
	const fieldHeader = new RegExp(`^    ${escapeRegExp(fieldName)}:\\s*`);
	let agentIndex = -1;
	for (let i = 0; i < lines.length; i++) if (agentHeader.test(lines[i])) { agentIndex = i; break; }
	if (agentIndex === -1) return raw;
	for (let i = agentIndex + 1; i < lines.length; i++) {
		if (/^  \S/.test(lines[i])) break;
		if (fieldHeader.test(lines[i])) {
			let end = i + 1;
			while (end < lines.length && /^      /.test(lines[end])) end++;
			lines.splice(i, end - i);
			return lines.join("\n");
		}
	}
	return raw;
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
			if (/^(roles|prompts|chains|pipelines):\s*$/.test(lines[i])) {
				lines.splice(i, 0, replacement);
				return lines.join("\n");
			}
		}
		lines.push(replacement);
		return lines.join("\n");
	}

	if (parts[0] === "pipelines" && parts[2] === "nodes" && parts.length >= 5) {
		const model = new ConfigShadowModel(mergeWithPackDefaults(normalizeConfig(parseSimpleYaml(raw))));
		model.setConfigValue(path, value);
		return configToYaml(model.snapshot());
	}

	if (parts[0] === "roles" && parts.length === 3) {
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

function sectionBounds(lines: string[], section: string): { start: number; end: number } {
	let start = lines.findIndex((line) => new RegExp(`^${escapeRegExp(section)}:\\s*$`).test(line));
	if (start === -1) {
		lines.push("", `${section}:`);
		start = lines.length - 1;
	}
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^\S[^:]*:\s*$/.test(lines[i])) { end = i; break; }
	}
	return { start, end };
}

function appendToYamlSection(raw: string, section: string, block: string): string {
	const lines = raw.replace(/\r/g, "").split("\n");
	const { end } = sectionBounds(lines, section);
	lines.splice(end, 0, block);
	return lines.join("\n");
}

function renameTopLevelMapEntry(raw: string, section: string, oldName: string, newName: string): string {
	const lines = raw.replace(/\r/g, "").split("\n");
	const { start, end } = sectionBounds(lines, section);
	const header = new RegExp(`^  ${yamlMapKeyRegex(oldName)}:\\s*`);
	for (let i = start + 1; i < end; i++) {
		if (header.test(lines[i])) { lines[i] = `  ${formatYamlMapKey(newName)}:`; return lines.join("\n"); }
	}
	throw new Error(`${section} entry '${oldName}' not found.`);
}

function deleteTopLevelMapEntry(raw: string, section: string, name: string): string {
	const lines = raw.replace(/\r/g, "").split("\n");
	const { start, end } = sectionBounds(lines, section);
	const header = new RegExp(`^  ${yamlMapKeyRegex(name)}:\\s*`);
	for (let i = start + 1; i < end; i++) {
		if (!header.test(lines[i])) continue;
		let deleteEnd = i + 1;
		while (deleteEnd < end && !/^  \S.*:\s*/.test(lines[deleteEnd])) deleteEnd++;
		lines.splice(i, deleteEnd - i);
		return lines.join("\n");
	}
	throw new Error(`${section} entry '${name}' not found.`);
}

function updateYamlReferences(raw: string, oldName: string, newName: string): string {
	let updated = raw;
	updated = updated.replace(new RegExp(`(role:\\s*)${yamlMapKeyRegex(oldName)}(?=\\s*$)`, "gm"), `$1${formatScalarForYaml(newName)}`);
	updated = updated.replace(new RegExp(`\\b${escapeRegExp(oldName)}\\b`, "g"), (match, offset, text) => {
		const lineStart = text.lastIndexOf("\n", offset) + 1;
		const lineEnd = text.indexOf("\n", offset);
		const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
		return /^  \S.*:\s*\[/.test(line) ? newName : match;
	});
	return updated;
}

function removeYamlReferences(raw: string, name: string): string {
	return raw.replace(new RegExp(`(role:\\s*)${yamlMapKeyRegex(name)}(?=\\s*$)`, "gm"), "$1");
}

function roleSectionName(_raw: string): "roles" {
	return "roles";
}

function appendAgentText(raw: string, name: string): string {
	if (new RegExp(`^  ${yamlMapKeyRegex(name)}:\s*$`, "m").test(raw)) throw new Error(`Role '${name}' already exists.`);
	const block = [`  ${formatYamlMapKey(name)}:`, `    description: ${name} role`, `    # model omitted: uses defaultModel`, `    provider: pi`, `    maxIterations: 1`, `    systemPrompt: |`, `      You are the ${name} role.`].join("\n");
	return appendToYamlSection(raw, roleSectionName(raw), block);
}

function appendPipelineText(raw: string, name: string): string {
	if (new RegExp(`^  ${yamlMapKeyRegex(name)}:\\s*$`, "m").test(raw)) throw new Error(`Pipeline '${name}' already exists.`);
	const block = [
		`  ${formatYamlMapKey(name)}:`,
		`    description: ${name} graph pipeline`,
		`    kind: composite`,
		`    nodes:`,
		`      workspace:`,
		`        kind: git.worktree`,
		`        nodes:`,
		`          run:`,
		`            kind: agent.pi`,
		`            role: worker`,
		`            prompt: blank`,
	].join("\n");
	return appendToYamlSection(raw, "pipelines", block);
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

function loadConfigSchema(): any {
	return JSON.parse(readFileSync(CONFIG_SCHEMA_PATH, "utf8"));
}

function resolveSchemaRef(root: any, schema: any): any {
	const ref = schema?.$ref;
	if (typeof ref !== "string" || !ref.startsWith("#/$defs/")) return schema;
	return root.$defs?.[ref.slice("#/$defs/".length)] || schema;
}

function schemaEnumForPath(path: string): string[] | undefined {
	const schema = loadConfigSchema();
	const parts = splitConfigPath(path);
	let current: any = schema;
	for (const part of parts) {
		current = resolveSchemaRef(schema, current);
		if (current.properties?.[part]) {
			current = current.properties[part];
			continue;
		}
		if (current.additionalProperties) {
			current = current.additionalProperties;
			continue;
		}
		return undefined;
	}
	current = resolveSchemaRef(schema, current);
	return Array.isArray(current.enum) ? current.enum.map(String) : undefined;
}

function configuredGraphNodePaths(pipelineName: string, nodes: Record<string, PipelineNodeDef> | undefined, prefix = `pipelines.${pipelineName}.nodes`): string[] {
	if (!nodes) return [];
	return Object.entries(nodes).flatMap(([nodeId, node]) => {
		const nodePrefix = `${prefix}.${nodeId}`;
		return [
			...(node.role !== undefined ? [`${nodePrefix}.role`] : []),
			...(node.prompt !== undefined ? [`${nodePrefix}.prompt`] : []),
			...(node.promptOverride !== undefined ? [`${nodePrefix}.promptOverride`] : []),
			...((node as any).model !== undefined ? [`${nodePrefix}.model`] : []),
			...((node as any).sandbox !== undefined ? [`${nodePrefix}.sandbox`] : []),
			...((node as any).maxIterations !== undefined ? [`${nodePrefix}.maxIterations`] : []),
			...configuredGraphNodePaths(pipelineName, node.nodes, `${nodePrefix}.nodes`),
			...(node.node ? configuredGraphNodePaths(pipelineName, { node: node.node }, nodePrefix) : []),
		];
	});
}

function configuredConfigPaths(cfg: SandcastleConfig): string[] {
	const rootPaths = ROOT_CONFIG_KEYS;
	const agentFields = ["description", "kind", "model", "sandbox", "provider", "maxIterations", "branch", "systemPrompt"];
	const pipelineFields = ["description", "model", "sandbox"];
	return [
		...rootPaths,
		...Object.keys(cfg.agents).flatMap((agent) => agentFields.map((field) => `roles.${agent}.${field}`)),
		...Object.entries(cfg.pipelines).flatMap(([pipeline, def]) => [
			...pipelineFields.map((field) => `pipelines.${pipeline}.${field}`),
			...configuredGraphNodePaths(pipeline, def.nodes),
		]),
	].sort();
}

function validateAgainstSchema(value: any, schema: any, root: any = schema, path = "config"): string[] {
	const resolved = resolveSchemaRef(root, schema);
	const issues: string[] = [];
	if (resolved.type === "object") {
		if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path} must be an object.`];
		for (const required of resolved.required || []) {
			if (value[required] === undefined) issues.push(`${path}.${required} is required.`);
		}
		for (const [key, entry] of Object.entries(value)) {
			const childSchema = resolved.properties?.[key] || resolved.additionalProperties;
			if (!childSchema && resolved.additionalProperties === false) {
				issues.push(`${path}.${key} is not supported.`);
				continue;
			}
			if (childSchema && typeof childSchema === "object") issues.push(...validateAgainstSchema(entry, childSchema, root, `${path}.${key}`));
		}
		return issues;
	}
	if (resolved.type === "array") {
		if (!Array.isArray(value)) return [`${path} must be an array.`];
		if (resolved.minItems !== undefined && value.length < resolved.minItems) issues.push(`${path} must contain at least ${resolved.minItems} item(s).`);
		if (resolved.items) value.forEach((entry, index) => issues.push(...validateAgainstSchema(entry, resolved.items, root, `${path}[${index}]`)));
		return issues;
	}
	if (resolved.type === "string") {
		if (typeof value !== "string") return [`${path} must be a string.`];
		if (resolved.minLength !== undefined && value.length < resolved.minLength) issues.push(`${path} must not be empty.`);
		if (resolved.pattern && !(new RegExp(resolved.pattern).test(value))) issues.push(`${path} does not match ${resolved.pattern}.`);
	}
	if (resolved.type === "integer" && (!Number.isInteger(value))) issues.push(`${path} must be an integer.`);
	if (resolved.minimum !== undefined && typeof value === "number" && value < resolved.minimum) issues.push(`${path} must be >= ${resolved.minimum}.`);
	if (Array.isArray(resolved.enum) && !resolved.enum.includes(value)) issues.push(`${path} must be one of: ${resolved.enum.join(", ")}.`);
	return issues;
}

function validateRawConfigText(raw: string): string[] {
	const allowedTopLevel = new Set(["runtimeVersion", ...ROOT_CONFIG_KEYS, "issueTracker", "issueTrackerSetupCommand", "roles", "prompts", "policies", "pipelines", "chains"]);
	const issues: string[] = [];
	for (const line of raw.replace(/\r/g, "").split("\n")) {
		const match = line.match(/^([A-Za-z0-9_-]+):\s*/);
		if (match && !allowedTopLevel.has(match[1])) issues.push(`config.${match[1]} is not supported.`);
	}
	return issues;
}

function stripUndefinedAndInternalKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripUndefinedAndInternalKeys);
	if (!value || typeof value !== "object") return value;
	const output: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (entry === undefined || key === "name") continue;
		output[key] = stripUndefinedAndInternalKeys(entry);
	}
	return output;
}

function configForSchemaValidation(cfg: SandcastleConfig): Record<string, unknown> {
	const value: Record<string, unknown> = { ...cfg, roles: cfg.agents };
	delete value.agents;
	delete value.issueTracker;
	delete value.issueTrackerSetupCommand;
	const stripped = stripUndefinedAndInternalKeys(value) as Record<string, unknown>;
	if (isRecord(stripped.pipelines)) {
		for (const pipeline of Object.values(stripped.pipelines)) {
			if (isRecord(pipeline) && (pipeline.kind !== undefined || pipeline.nodes !== undefined) && Array.isArray(pipeline.steps) && pipeline.steps.length === 0) delete pipeline.steps;
		}
	}
	return stripped;
}

function validateConfig(cwd: string, cfg: SandcastleConfig): string[] {
	const issues: string[] = [];
	const configPath = join(cwd, CONFIG_PATH);
	const runnerPath = join(cwd, RUNNER_PATH);
	if (!existsSync(configPath)) issues.push(`Missing config scaffold: ${CONFIG_PATH}`);
	else issues.push(...validateRawConfigText(readFileSync(configPath, "utf8")));
	if (!existsSync(runnerPath)) issues.push(`Missing runner scaffold: ${RUNNER_PATH}`);
	issues.push(...validateAgainstSchema(configForSchemaValidation(cfg), loadConfigSchema()));
	if (!Object.keys(cfg.agents).length) issues.push("No roles configured.");
	for (const [name, agent] of Object.entries(cfg.agents)) {
		if (!agent.description) issues.push(`Role '${name}' is missing a description.`);
		// Role model is optional; unset means inherit defaultModel, and "Agent Default" defers to the provider.
		if (agent.sandbox && !SUPPORTED_SANDBOXES.has(agent.sandbox)) {
			issues.push(`Role '${name}' uses unsupported sandbox provider '${agent.sandbox}'.`);
		}
		if (agent.maxIterations !== undefined && (!Number.isInteger(agent.maxIterations) || agent.maxIterations < 1)) {
			issues.push(`Role '${name}' has an invalid maxIterations value.`);
		}
		if (agent.kind && !["planWork", "runRole", "review", "merge"].includes(agent.kind)) issues.push(`Role '${name}' has unsupported kind '${agent.kind}'.`);
		if (agent.systemPrompt && !agent.systemPrompt.trim()) issues.push(`Role '${name}' has an empty system prompt.`);
	}
	const planWorkRoles = Object.entries(cfg.agents).filter(([, agent]) => agent.kind === "planWork").map(([name]) => name);
	if (planWorkRoles.length > 1) issues.push(`Exactly one role may have kind 'planWork'; found ${planWorkRoles.join(", ")}.`);
	for (const [chainName, steps] of Object.entries(cfg.chains)) {
		if (!Array.isArray(steps) || !steps.length) {
			issues.push(`Chain '${chainName}' has no steps.`);
			continue;
		}
		for (const step of steps) {
			if (!cfg.agents[step.role]) issues.push(`Chain '${chainName}' references unknown role '${step.role}'.`);
			if (!step.prompt || !step.prompt.trim()) issues.push(`Chain '${chainName}' has an empty prompt step.`);
		}
	}
	if (cfg.defaultSandbox && !SUPPORTED_SANDBOXES.has(cfg.defaultSandbox)) {
		issues.push(`Default sandbox provider '${cfg.defaultSandbox}' is unsupported.`);
	}
	return issues;
}

function normalizeModelSetting(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "" || value === DEFAULT_MODEL || value === "default") return undefined;
	return String(value);
}

function normalizeAgentConfig(agent: AgentDef): AgentDef {
	return { ...agent, model: normalizeModelSetting(agent.model) };
}

function normalizePipelineStepConfig(step: PipelineStep): PipelineStep {
	return { ...step, model: normalizeModelSetting(step.model) };
}

function normalizePipelineConfig(pipeline: PipelineDef): PipelineDef {
	return {
		...pipeline,
		model: normalizeModelSetting(pipeline.model),
		steps: (pipeline.steps || []).map(normalizePipelineStepConfig),
	};
}

function normalizeConfig(cfg: Partial<SandcastleConfig>): SandcastleConfig {
	return {
		defaultSandbox: cfg.defaultSandbox ?? DEFAULT_SANDBOX,
		defaultModel: normalizeModelSetting(cfg.defaultModel),
		defaultPipeline: cfg.defaultPipeline ?? "simple-loop",
		defaultAgent: cfg.defaultAgent ?? "claude-code",
		maxWorkers: cfg.maxWorkers ?? 5,
		maxIterations: cfg.maxIterations ?? 10,
		workSource: cfg.workSource ?? cfg.issueTracker ?? "github-issues",
		workSourceSetupCommand: cfg.workSourceSetupCommand ?? cfg.issueTrackerSetupCommand,
		issueTracker: cfg.issueTracker,
		issueTrackerSetupCommand: cfg.issueTrackerSetupCommand,
		imageNamePattern: cfg.imageNamePattern ?? "sandcastle:<repo-dir-name>",
		prompts: cfg.prompts || {},
		agents: Object.fromEntries(Object.entries(cfg.agents || {}).map(([name, agent]) => [name, normalizeAgentConfig(agent)])),
		chains: cfg.chains || {},
		pipelines: Object.fromEntries(Object.entries(cfg.pipelines || {}).map(([name, pipeline]) => [name, normalizePipelineConfig(pipeline)])),
	};
}

const DEFAULT_CONFIG = normalizeConfig(packsToConfig());

export function selectPlanWorkRoleName(cfg: Pick<SandcastleConfig, "agents">): string {
	const matches = Object.entries(cfg.agents).filter(([, agent]) => agent.kind === "planWork").map(([name]) => name);
	if (matches.length === 1) return matches[0]!;
	if (matches.length > 1) throw new Error(`Multiple planWork roles configured: ${matches.join(", ")}. Exactly one role may have kind: planWork.`);
	throw new Error("No planWork role configured. /work:plan requires exactly one role with kind: planWork and will not infer planning from role names.");
}

function resolvePromptText(cfg: SandcastleConfig, promptRef: string): string {
	return cfg.prompts[promptRef]?.template || promptRef;
}

function stepsMatchRolePromptShape(steps: PipelineStep[], expected: Array<{ role: string; prompt: string }>): boolean {
	return steps.length === expected.length && steps.every((step, index) => step.role === expected[index]?.role && step.prompt === expected[index]?.prompt);
}

function pipelineStepsMatchDefaultLegacyShape(name: string, pipeline: PipelineDef, defaultPipeline: PipelineDef): boolean {
	const steps = pipeline.steps || [];
	const defaultSteps = defaultPipeline.steps || [];
	if (!steps.length) return false;
	if (stepsMatchRolePromptShape(steps, defaultSteps.map((step) => ({ role: step.role, prompt: step.prompt })))) return true;
	const staleGeneratedShapes: Record<string, Array<{ role: string; prompt: string }>> = {
		"parallel-planner": [
			{ role: "planner", prompt: "plan-work" },
			{ role: "implementer", prompt: "implement-work" },
			{ role: "merger", prompt: "merge-work" },
		],
		"parallel-planner-with-review": [
			{ role: "planner", prompt: "plan-work" },
			{ role: "implementer", prompt: "implement-work" },
			{ role: "reviewer", prompt: "review-work" },
			{ role: "merger", prompt: "merge-work" },
		],
	};
	return staleGeneratedShapes[name] ? stepsMatchRolePromptShape(steps, staleGeneratedShapes[name]) : false;
}

function mergeWithPackDefaults(cfg: SandcastleConfig): SandcastleConfig {
	const agents = { ...DEFAULT_CONFIG.agents } as Record<string, AgentDef>;
	for (const [name, agent] of Object.entries(cfg.agents || {})) agents[name] = { ...(DEFAULT_CONFIG.agents[name] || { name }), ...agent, name };
	const pipelines = { ...DEFAULT_CONFIG.pipelines } as Record<string, PipelineDef>;
	for (const [name, pipeline] of Object.entries(cfg.pipelines || {})) {
		const defaultPipeline = DEFAULT_CONFIG.pipelines[name] || { steps: [] };
		const userDefinesLegacySteps = Array.isArray(pipeline.steps) && pipeline.steps.length > 0 && !pipeline.nodes;
		const staleGeneratedLegacyDefault = userDefinesLegacySteps && pipelineStepsMatchDefaultLegacyShape(name, pipeline, defaultPipeline);
		pipelines[name] = {
			...defaultPipeline,
			...pipeline,
			kind: pipeline.kind ?? (userDefinesLegacySteps && !staleGeneratedLegacyDefault ? undefined : defaultPipeline.kind),
			nodes: pipeline.nodes ?? (userDefinesLegacySteps && !staleGeneratedLegacyDefault ? undefined : defaultPipeline.nodes),
			steps: pipeline.steps || defaultPipeline.steps || [],
		};
	}
	return {
		...DEFAULT_CONFIG,
		...cfg,
		prompts: { ...DEFAULT_CONFIG.prompts, ...cfg.prompts },
		agents,
		chains: { ...DEFAULT_CONFIG.chains, ...cfg.chains },
		pipelines,
	};
}

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

function lineIndent(line: string): number {
	return line.match(/^\s*/)?.[0].length ?? 0;
}

function nextYamlContentLine(lines: string[], start: number): number {
	let index = start;
	while (index < lines.length) {
		const trimmed = lines[index].trim();
		if (trimmed && !trimmed.startsWith("#")) break;
		index++;
	}
	return index;
}

function parseYamlBlockScalar(lines: string[], start: number, parentIndent: number): { value: string; next: number } {
	const text: string[] = [];
	let index = start;
	while (index < lines.length) {
		const line = lines[index];
		const trimmed = line.trim();
		const indent = lineIndent(line);
		if (trimmed && indent <= parentIndent) break;
		if (!trimmed) text.push("");
		else text.push(line.slice(Math.min(indent, parentIndent + 2)));
		index++;
	}
	return { value: text.join("\n").trimEnd(), next: index };
}

function parseYamlKeyValue(text: string): { key: string; value: string } | null {
	const match = text.match(/^(.+?):(?:\s*(.*))?$/);
	if (!match) return null;
	return { key: parseYamlMapKey(match[1]), value: match[2] ?? "" };
}

function parseYamlMapBlock(lines: string[], start: number, indent: number): { value: Record<string, unknown>; next: number } {
	const value: Record<string, unknown> = {};
	let index = start;
	while (index < lines.length) {
		index = nextYamlContentLine(lines, index);
		if (index >= lines.length) break;
		const line = lines[index];
		const currentIndent = lineIndent(line);
		const trimmed = line.trim();
		if (currentIndent < indent || trimmed.startsWith("- ")) break;
		if (currentIndent > indent) {
			index++;
			continue;
		}
		const pair = parseYamlKeyValue(trimmed);
		if (!pair) {
			index++;
			continue;
		}
		if (pair.value === "|") {
			const block = parseYamlBlockScalar(lines, index + 1, currentIndent);
			value[pair.key] = block.value;
			index = block.next;
			continue;
		}
		if (pair.value === "") {
			const childIndex = nextYamlContentLine(lines, index + 1);
			if (childIndex < lines.length && lineIndent(lines[childIndex]) > currentIndent) {
				const block = parseYamlBlock(lines, childIndex, lineIndent(lines[childIndex]));
				value[pair.key] = block.value;
				index = block.next;
				continue;
			}
			value[pair.key] = {};
			index++;
			continue;
		}
		value[pair.key] = parseScalar(pair.value);
		index++;
	}
	return { value, next: index };
}

function parseYamlSequenceBlock(lines: string[], start: number, indent: number): { value: unknown[]; next: number } {
	const value: unknown[] = [];
	let index = start;
	while (index < lines.length) {
		index = nextYamlContentLine(lines, index);
		if (index >= lines.length) break;
		const line = lines[index];
		const currentIndent = lineIndent(line);
		const trimmed = line.trim();
		if (currentIndent < indent || !trimmed.startsWith("- ")) break;
		if (currentIndent > indent) {
			index++;
			continue;
		}
		const rest = trimmed.slice(2).trim();
		if (!rest) {
			const childIndex = nextYamlContentLine(lines, index + 1);
			if (childIndex < lines.length && lineIndent(lines[childIndex]) > currentIndent) {
				const block = parseYamlBlock(lines, childIndex, lineIndent(lines[childIndex]));
				value.push(block.value);
				index = block.next;
				continue;
			}
			value.push(null);
			index++;
			continue;
		}
		const pair = parseYamlKeyValue(rest);
		if (pair) {
			const entry: Record<string, unknown> = {};
			if (pair.value === "|") {
				const block = parseYamlBlockScalar(lines, index + 1, currentIndent);
				entry[pair.key] = block.value;
				index = block.next;
			} else if (pair.value === "") {
				const childIndex = nextYamlContentLine(lines, index + 1);
				if (childIndex < lines.length && lineIndent(lines[childIndex]) > currentIndent) {
					const block = parseYamlBlock(lines, childIndex, lineIndent(lines[childIndex]));
					entry[pair.key] = block.value;
					index = block.next;
				} else {
					entry[pair.key] = {};
					index++;
				}
			} else {
				entry[pair.key] = parseScalar(pair.value);
				index++;
			}
			const childIndex = nextYamlContentLine(lines, index);
			if (childIndex < lines.length && lineIndent(lines[childIndex]) > currentIndent) {
				const block = parseYamlMapBlock(lines, childIndex, currentIndent + 2);
				Object.assign(entry, block.value);
				index = block.next;
			}
			value.push(entry);
			continue;
		}
		value.push(parseScalar(rest));
		index++;
	}
	return { value, next: index };
}

function parseYamlBlock(lines: string[], start: number, indent: number): { value: unknown; next: number } {
	const index = nextYamlContentLine(lines, start);
	if (index >= lines.length) return { value: {}, next: index };
	const trimmed = lines[index].trim();
	if (lineIndent(lines[index]) === indent && trimmed.startsWith("- ")) return parseYamlSequenceBlock(lines, index, indent);
	return parseYamlMapBlock(lines, index, indent);
}

function parseYamlDocument(raw: string): Record<string, unknown> {
	const lines = raw.replace(/\r/g, "").split("\n");
	const parsed = parseYamlBlock(lines, 0, 0).value;
	return isRecord(parsed) ? parsed : {};
}

function cloneYamlValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(cloneYamlValue);
	if (!isRecord(value)) return value;
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneYamlValue(entry)]));
}

function normalizeParsedPipelineNodes(value: Record<string, unknown>): Record<string, PipelineNodeDef> {
	return Object.fromEntries(Object.entries(value).map(([id, node]) => [id, normalizeParsedPipelineNode(isRecord(node) ? node : { kind: node })]));
}

function normalizeParsedPipelineNode(value: Record<string, unknown>): PipelineNodeDef {
	const node: PipelineNodeDef = {};
	for (const [key, entry] of Object.entries(value)) {
		if (key === "nodes" && isRecord(entry)) node.nodes = normalizeParsedPipelineNodes(entry);
		else (node as Record<string, unknown>)[key] = cloneYamlValue(entry);
	}
	return node;
}

function normalizeParsedMapPipeline(value: Record<string, unknown>, fallback?: PipelineDef): PipelineDef {
	const pipeline: PipelineDef = { ...(fallback || { steps: [] }), steps: fallback?.steps || [] };
	for (const [key, entry] of Object.entries(value)) {
		if (key === "nodes" && isRecord(entry)) pipeline.nodes = normalizeParsedPipelineNodes(entry);
		else if (key === "steps" && Array.isArray(entry)) pipeline.steps = entry as PipelineStep[];
		else (pipeline as Record<string, unknown>)[key] = cloneYamlValue(entry);
	}
	return pipeline;
}

function mergeMapFormPipelines(raw: string, pipelines: Record<string, PipelineDef>): Record<string, PipelineDef> {
	const parsedPipelines = parseYamlDocument(raw).pipelines;
	if (!isRecord(parsedPipelines)) return pipelines;
	const merged = { ...pipelines };
	for (const [name, value] of Object.entries(parsedPipelines)) {
		if (!isRecord(value)) continue;
		if (value.kind !== undefined || value.nodes !== undefined) merged[name] = normalizeParsedMapPipeline(value, merged[name]);
	}
	return merged;
}

export function parseSimpleYaml(raw: string): SandcastleConfig {
	const cfg: SandcastleConfig = { prompts: {}, agents: {}, chains: {}, pipelines: {} };
	const lines = raw.replace(/\r/g, "").split("\n");
	let section = "";
	let currentAgent = "";
	let currentPrompt = "";
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
		const top = trimmed.match(/^(defaultSandbox|defaultModel|defaultPipeline|defaultAgent|maxWorkers|maxIterations|workSource|workSourceSetupCommand|issueTracker|issueTrackerSetupCommand|imageNamePattern):\s*(.*)$/);
		if (top) {
			const key = top[1] as RootConfigKey;
			setField(cfg, key, parseScalar(top[2]) as SandcastleConfig[typeof key]);
			continue;
		}
		const sectionMatch = line.match(/^(roles|prompts|chains|pipelines):\s*$/);
		if (sectionMatch) {
			section = sectionMatch[1];
			currentAgent = "";
			currentPrompt = "";
			currentChain = "";
			currentPipeline = "";
			currentPipelineStep = null;
			currentBranchStrategy = null;
			continue;
		}
		if (section === "prompts") {
			const promptMatch = line.match(/^  (\S.*):\s*$/);
			if (promptMatch) {
				currentPrompt = parseYamlMapKey(promptMatch[1]);
				cfg.prompts[currentPrompt] = {};
				continue;
			}
			const field = line.match(/^\s{4}([A-Za-z0-9_-]+):\s*(.*)$/);
			if (field && currentPrompt) {
				const prompt = cfg.prompts[currentPrompt];
				const key = field[1] as keyof PromptDef;
				blockTarget = assignBlockOrScalar(field[2], 4, (value) => {
					setField(prompt, key, value as PromptDef[typeof key]);
				});
			}
			continue;
		}
		if (section === "roles") {
			const agentMatch = line.match(/^  (\S.*):\s*$/);
			if (agentMatch) {
				currentAgent = parseYamlMapKey(agentMatch[1]);
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
		if (section === "chains") {
			const chain = line.match(/^  (\S.*):\s*$/);
			if (chain) {
				currentChain = parseYamlMapKey(chain[1]);
				cfg.chains[currentChain] = [];
				continue;
			}
			const step = line.match(/^\s{4}-\s+role:\s*(.+)$/);
			if (step && currentChain) {
				currentStep = { role: parseScalar(step[1]), prompt: DEFAULT_STEP_PROMPT };
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
			const pipeline = line.match(/^  (\S.*):\s*$/);
			if (pipeline) {
				currentPipeline = parseYamlMapKey(pipeline[1]);
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
			const roleStep = line.match(/^\s{6}-\s+role:\s*(.+)$/);
			if (roleStep) {
				currentPipelineStep = { kind: "runRole", role: parseScalar(roleStep[1]), prompt: DEFAULT_STEP_PROMPT };
				cfg.pipelines[currentPipeline].steps.push(currentPipelineStep);
				continue;
			}
			const unknownStep = line.match(/^\s{6}-\s+([A-Za-z0-9_-]+):\s*(.*)$/);
			if (unknownStep) {
				currentPipelineStep = { kind: "runRole", role: "", prompt: DEFAULT_STEP_PROMPT } as any;
				setField(currentPipelineStep as any, unknownStep[1] as any, parseScalar(unknownStep[2]) as any);
				cfg.pipelines[currentPipeline].steps.push(currentPipelineStep);
				continue;
			}
			const kindStep = line.match(/^\s{6}-\s+kind:\s*(.+)$/);
			if (kindStep) {
				currentPipelineStep = { kind: parseScalar(kindStep[1]), role: "", prompt: DEFAULT_STEP_PROMPT };
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
	cfg.pipelines = mergeMapFormPipelines(raw, cfg.pipelines);
	return cfg;
}

async function loadConfig(cwd: string): Promise<SandcastleConfig> {
	const raw = readConfigText(cwd);
	return mergeWithPackDefaults(normalizeConfig(parseSimpleYaml(raw)));
}

async function loadExistingConfig(cwd: string): Promise<SandcastleConfig> {
	const raw = readExistingConfigText(cwd);
	return mergeWithPackDefaults(normalizeConfig(parseSimpleYaml(raw)));
}

function resolveDefaultRunAgentName(cfg: SandcastleConfig): string | undefined {
	return Object.entries(cfg.agents).find(([, agent]) => Boolean(agent.model && agent.model !== DEFAULT_MODEL))?.[0] || Object.keys(cfg.agents)[0];
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

interface ScRunRecord {
	id: string;
	kind?: "direct-role";
	agent: string;
	prompt: string;
	promptSummary?: string;
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

function formatPipelineWorkerRows(record: Pick<WorkProcessRunRecord, "workerStatuses"> | undefined): string[] {
	return (record?.workerStatuses || []).map((step) => {
		const item = step.itemId ? `; item ${step.itemId}` : "";
		const node = step.nodePath ? `; node ${step.nodePath}` : "";
		const lane = step.laneId ? `; lane ${step.laneId}` : "";
		const branch = step.branch ? `; branch ${step.branch}` : "";
		const commits = step.commits?.length ? `; commits ${step.commits.join(", ")}` : "";
		const log = step.logPath ? `; log ${step.logPath}` : "";
		return `Worker ${step.index + 1}: ${step.role} ${step.status}${item}${node}${lane}${branch}${commits}${log}`;
	});
}

function formatWorkProcessSummary(input: { record: WorkProcessRunRecord; recordPath: string; advisoryNotes?: string[] }): string {
	const lines = [
		`Work process ${input.record.status}: ${input.record.id} · pipeline ${input.record.pipeline}`,
		`Pipeline: ${input.record.pipeline}`,
		`Items: ${input.record.resolvedItems.length}`,
		...formatPipelineWorkerRows(input.record),
		`Record: ${input.recordPath}`,
	];
	if (input.record.branches.length) lines.push(`Branches: ${input.record.branches.join(", ")}`);
	if (input.record.logs.length) lines.push(`Logs: ${input.record.logs.join(", ")}`);
	if (input.advisoryNotes?.length) lines.push(...input.advisoryNotes);
	return lines.join("\n");
}

const AGENT_DEFAULT_MODELS: Record<string, string> = {
	claude: "claude-opus-4-8",
	"claude-code": "claude-opus-4-8",
	pi: "claude-sonnet-4-6",
	codex: "gpt-5.4",
	cursor: "composer-2",
	opencode: "opencode/big-pickle",
	copilot: "claude-sonnet-4.5",
};

function resolveModelForProvider(model: string | undefined, provider: string | undefined): string {
	if (provider === "pi" && (!model || model === "Agent Default")) return "Agent Default";
	if (!model || model === DEFAULT_MODEL) return AGENT_DEFAULT_MODELS[provider || "pi"] || AGENT_DEFAULT_MODELS.pi;
	return model;
}

interface HostPiDefaults {
	provider?: string;
	model?: string;
	thinking?: string;
}

interface HostPiAgentRuntime {
	dir: string;
	fileMounts: Array<{ hostPath: string; sandboxPath: string; readonly: true }>;
}

const HOST_PI_SANDBOX_DIR = "/home/agent/.pi-host-agent";

function readHostPiDefaults(): HostPiDefaults {
	const settingsPath = join(process.env.PI_CODING_AGENT_DIR || process.env.PI_HOST_AGENT_DIR || join(process.env.HOME || "", ".pi", "agent"), "settings.json");
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
		return {
			provider: typeof settings.defaultProvider === "string" && settings.defaultProvider.trim() ? settings.defaultProvider : undefined,
			model: typeof settings.defaultModel === "string" && settings.defaultModel.trim() ? settings.defaultModel : undefined,
			thinking: typeof settings.defaultThinkingLevel === "string" && settings.defaultThinkingLevel.trim() ? settings.defaultThinkingLevel : undefined,
		};
	} catch {
		return {};
	}
}

function resolvePipelineModelForProvider(model: string | undefined, provider: string | undefined): string {
	if (provider === "pi" && (!model || model === DEFAULT_MODEL)) return DEFAULT_MODEL;
	return resolveModelForProvider(model, provider);
}

function createHostPiAgentRuntime(): HostPiAgentRuntime {
	const sourceDir = process.env.PI_HOST_AGENT_DIR || join(process.env.HOME || "", ".pi", "agent");
	const tmp = mkdtempSync(join(tmpdir(), "agent-workflows-pi-agent-"));
	mkdirSync(join(tmp, "sessions"), { recursive: true });
	const settingsPath = join(sourceDir, "settings.json");
	let settings: any = {};
	try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch {}
	writeFileSync(join(tmp, "settings.json"), JSON.stringify({
		defaultProvider: settings.defaultProvider,
		defaultModel: settings.defaultModel,
		defaultThinkingLevel: settings.defaultThinkingLevel,
		theme: settings.theme,
	}, null, 2));
	const fileMounts: Array<{ hostPath: string; sandboxPath: string; readonly: true }> = [];
	const authPath = join(sourceDir, "auth.json");
	if (existsSync(authPath)) fileMounts.push({ hostPath: authPath, sandboxPath: `${HOST_PI_SANDBOX_DIR}/auth.json`, readonly: true });
	const trustPath = join(sourceDir, "trust.json");
	if (existsSync(trustPath)) fileMounts.push({ hostPath: trustPath, sandboxPath: `${HOST_PI_SANDBOX_DIR}/trust.json`, readonly: true });
	return { dir: tmp, fileMounts };
}

function piAgentRuntimeDir(hostPiRuntime: HostPiAgentRuntime | undefined, sandbox: AgentDef["sandbox"] | undefined): string | undefined {
	if (!hostPiRuntime) return undefined;
	return sandbox === "no-sandbox" ? hostPiRuntime.dir : HOST_PI_SANDBOX_DIR;
}

function piAgentEnvironment(hostPiRuntime: HostPiAgentRuntime | undefined, sandbox: AgentDef["sandbox"] | undefined): Record<string, string> | undefined {
	const dir = piAgentRuntimeDir(hostPiRuntime, sandbox);
	if (!dir || sandbox === "no-sandbox") return undefined;
	return {
		PI_CODING_AGENT_DIR: dir,
		PI_CODING_AGENT_SESSION_DIR: `${dir}/sessions`,
	};
}

function hostPiSandboxOptions(cwd: string, cfg: Partial<SandcastleConfig>, hostPiRuntime: HostPiAgentRuntime | undefined): Record<string, unknown> | undefined {
	const options: Record<string, unknown> = { imageName: defaultSandcastleImageName(cwd, cfg.imageNamePattern) };
	if (hostPiRuntime) {
		options.mounts = [
			{ hostPath: hostPiRuntime.dir, sandboxPath: HOST_PI_SANDBOX_DIR, readonly: false },
			...hostPiRuntime.fileMounts,
		];
		options.env = piAgentEnvironment(hostPiRuntime, "docker");
	}
	return options;
}

function createPiAgentWithHostDefaults(model: string | undefined, hostPiRuntime: HostPiAgentRuntime | undefined, sandbox: AgentDef["sandbox"] | undefined, piFactory = piAgent): any {
	const host = readHostPiDefaults();
	const explicitModel = Boolean(model && model !== DEFAULT_MODEL);
	const effectiveModel = explicitModel ? model : host.model;
	const base = piFactory(effectiveModel || DEFAULT_MODEL, { captureSessions: false } as any);
	const nonCapturing = { ...base, captureSessions: false, sessionStorage: undefined };
	if (explicitModel) return nonCapturing;
	return {
		...nonCapturing,
		buildPrintCommand({ prompt, resumeSession }: any) {
			const sessionFlag = resumeSession ? ` --session ${shellEscapeForCommand(resumeSession)}` : "";
			const providerFlag = host.provider ? ` --provider ${shellEscapeForCommand(host.provider)}` : "";
			const modelFlag = effectiveModel ? ` --model ${shellEscapeForCommand(effectiveModel)}` : "";
			const thinkingFlag = host.thinking ? ` --thinking ${shellEscapeForCommand(host.thinking)}` : "";
			return { command: `pi -p --mode json --no-session${providerFlag}${modelFlag}${thinkingFlag}${sessionFlag}`, stdin: prompt };
		},
		buildInteractiveArgs({ prompt }: any) {
			const args = ["pi", "--no-session"];
			if (host.provider) args.push("--provider", host.provider);
			if (effectiveModel) args.push("--model", effectiveModel);
			if (host.thinking) args.push("--thinking", host.thinking);
			if (prompt) args.push(prompt);
			return args;
		},
	};
}

function createAgentProviderForRuntime(model: string, provider: AgentDef["provider"] | undefined, options: { hostPiRuntime?: HostPiAgentRuntime; sandbox?: AgentDef["sandbox"]; claudeCodeFactory?: typeof claudeCode } = {}): any {
	if (provider === "claude" || provider === "claude-code") return options.claudeCodeFactory ? options.claudeCodeFactory(model) : claudeCode(model);
	if (provider === "codex") return codex(model);
	if (provider === "cursor") return cursor(model);
	if (provider === "opencode") return opencode(model);
	if (provider === "copilot") return copilot(model);
	return createPiAgentWithHostDefaults(model, options.hostPiRuntime, options.sandbox);
}

function shellEscapeForCommand(value: unknown): string {
	return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function resolveAgentRuntimeSettings(agent: AgentDef, cfg: SandcastleConfig): AgentRuntimeSettings {
	const provider = agent.provider || cfg.defaultAgent || "claude-code";
	return {
		model: resolveModelForProvider(agent.model || cfg.defaultModel, provider),
		sandbox: agent.sandbox || cfg.defaultSandbox || DEFAULT_SANDBOX,
		provider,
	};
}

function resolveSandboxProvider(kind: SandcastleSandbox, options?: Record<string, unknown>): SandboxProvider {
	if (kind === "podman") return podman(options as any);
	if (kind === "vercel") return vercel();
	if (kind === "no-sandbox") return noSandbox();
	return docker(options as any);
}

const createDefaultSandcastleRunCapability = (): SandcastleRunCapability => ({
	makeAgent: (model, provider = "pi") => createAgentProviderForRuntime(model, provider),
	makeSandbox: (kind) => resolveSandboxProvider(kind),
	run: sandcastleRun,
});

function defaultSandcastleImageName(cwd: string, pattern = "sandcastle:<repo-dir-name>"): string {
	const dirName = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "local";
	const sanitized = dirName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
	return pattern.replace(/<repo-dir-name>/g, sanitized || "local");
}

function imageProviderForSandbox(sandbox: AgentDef["sandbox"]): "docker" | "podman" | undefined {
	if (sandbox === "docker" || sandbox === "podman") return sandbox;
	return undefined;
}

function latestMtimeMs(path: string): number | undefined {
	if (!existsSync(path)) return undefined;
	const stat = statSync(path);
	let latest = stat.mtimeMs;
	if (!stat.isDirectory()) return latest;
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		const child = latestMtimeMs(join(path, entry.name));
		if (child !== undefined && child > latest) latest = child;
	}
	return latest;
}

function runProcess(cwd: string, command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		proc.stdout?.setEncoding("utf8");
		proc.stderr?.setEncoding("utf8");
		proc.stdout?.on("data", (chunk) => { stdout += String(chunk); });
		proc.stderr?.on("data", (chunk) => { stderr += String(chunk); });
		proc.on("error", reject);
		proc.on("close", (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}: ${stderr || stdout}`.trim()));
		});
	});
}

async function inspectImageCreated(cwd: string, provider: "docker" | "podman", imageName: string): Promise<Date | undefined> {
	try {
		const result = await runProcess(cwd, provider, ["image", "inspect", imageName, "--format", "{{.Created}}"]);
		const created = new Date(result.stdout.trim());
		return Number.isNaN(created.getTime()) ? undefined : created;
	} catch {
		return undefined;
	}
}

function missingSandcastleCliScaffoldMessage(): string {
	return [
		"Execution runtime scaffold is missing: .sandcastle/.",
		"Initialize it with /work:build-image or save config with rebuild enabled. The extension runs unattended npx @ai-hero/sandcastle init using values from .pi/sandcastle/config.yaml.",
	].join("\n");
}

function scaffoldStatePath(cwd: string): string {
	return join(cwd, SCAFFOLD_STATE_PATH);
}

function scaffoldSetupSignature(cfg: SandcastleConfig): Record<string, unknown> {
	return {
		runtimeVersion: 1,
		defaultPipeline: cfg.defaultPipeline || "simple-loop",
		defaultAgent: cfg.defaultAgent || "claude-code",
		maxWorkers: cfg.maxWorkers || 5,
		maxIterations: cfg.maxIterations || 10,
		defaultSandbox: imageProviderForSandbox(cfg.defaultSandbox) || "docker",
		defaultModel: cfg.defaultModel && cfg.defaultModel !== DEFAULT_MODEL ? cfg.defaultModel : DEFAULT_MODEL,
		issueTracker: cfg.workSource || cfg.issueTracker || "github-issues",
		issueTrackerSetupCommand: (cfg.workSource || cfg.issueTracker) === "custom" ? (cfg.workSourceSetupCommand || cfg.issueTrackerSetupCommand || "") : "",
	};
}

function readScaffoldSetupSignature(cwd: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(scaffoldStatePath(cwd), "utf8"))?.setupSignature;
	} catch {
		return undefined;
	}
}

function writeScaffoldSetupSignature(cwd: string, cfg: SandcastleConfig): void {
	mkdirSync(dirname(scaffoldStatePath(cwd)), { recursive: true });
	writeFileSync(scaffoldStatePath(cwd), JSON.stringify({ setupSignature: scaffoldSetupSignature(cfg), updatedAt: new Date().toISOString() }, null, 2));
}

function scaffoldSetupNeedsReinit(cwd: string, cfg: SandcastleConfig): boolean {
	return JSON.stringify(readScaffoldSetupSignature(cwd) || null) !== JSON.stringify(scaffoldSetupSignature(cfg));
}

async function ensureSandcastleCliScaffold(cwd: string, cfg: SandcastleConfig, options: { reinitialize?: boolean; runIssueTrackerSetup?: boolean } = {}): Promise<{ changes: string[] }> {
	const scaffoldPath = join(cwd, ".sandcastle");
	if (existsSync(scaffoldPath)) {
		if (!options.reinitialize) return { changes: [] };
		rmSync(scaffoldPath, { recursive: true, force: true });
	}
	const sandbox = imageProviderForSandbox(cfg.defaultSandbox) || "docker";
	const args = [
		"init",
		"--template", cfg.defaultPipeline || "simple-loop",
		"--agent", cfg.defaultAgent || "claude-code",
		"--sandbox", sandbox,
		"--issue-tracker", cfg.workSource || cfg.issueTracker || "github-issues",
		"--create-label", "false",
		"--build-image", "false",
		"--install-template-deps", "true",
	];
	if (cfg.defaultModel && cfg.defaultModel !== DEFAULT_MODEL) args.splice(5, 0, "--model", cfg.defaultModel);
	await runProcess(cwd, "npx", ["@ai-hero/sandcastle", ...args]);
	if (options.runIssueTrackerSetup && (cfg.workSource || cfg.issueTracker || "github-issues") === "custom" && (cfg.workSourceSetupCommand || cfg.issueTrackerSetupCommand)) await runProcess(cwd, process.env.SHELL || "sh", ["-lc", cfg.workSourceSetupCommand || cfg.issueTrackerSetupCommand!]);
	writeScaffoldSetupSignature(cwd, cfg);
	return { changes: [options.reinitialize ? "reinitialized .sandcastle/" : "wrote .sandcastle/"] };
}

function requireSandcastleCliScaffold(cwd: string): void {
	if (!existsSync(join(cwd, ".sandcastle"))) throw new Error(missingSandcastleCliScaffoldMessage());
}

function defaultSandboxContainerfile(): string {
	return [
		"FROM node:22-bookworm",
		"",
		"RUN apt-get update && apt-get install -y git curl jq && rm -rf /var/lib/apt/lists/*",
		"RUN corepack enable && corepack prepare pnpm@latest --activate",
		"",
		"ARG AGENT_UID=1000",
		"ARG AGENT_GID=1000",
		"RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node",
		"USER ${AGENT_UID}:${AGENT_GID}",
		"WORKDIR /home/agent",
		"ENTRYPOINT [\"sleep\", \"infinity\"]",
		"",
	].join("\n");
}

function ensureSandboxContainerfile(cwd: string, provider: "docker" | "podman", notify?: (message: string, type?: string) => void): void {
	const sandcastleDir = join(cwd, ".sandcastle");
	const dockerfile = join(sandcastleDir, "Dockerfile");
	const containerfile = join(sandcastleDir, "Containerfile");
	if (existsSync(dockerfile) || existsSync(containerfile)) return;
	mkdirSync(sandcastleDir, { recursive: true });
	const target = provider === "podman" ? containerfile : dockerfile;
	writeFileSync(target, defaultSandboxContainerfile());
	notify?.(`Wrote missing ${provider === "podman" ? "Containerfile" : "Dockerfile"} for sandbox image build.`, "info");
}

async function ensureScaffoldForImageBuild(cwd: string, cfg: SandcastleConfig, provider: "docker" | "podman", notify?: (message: string, type?: string) => void): Promise<void> {
	const scaffoldPath = join(cwd, ".sandcastle");
	if (!existsSync(scaffoldPath)) {
		notify?.("Execution runtime scaffold .sandcastle/ is missing; running unattended npx @ai-hero/sandcastle init before building.", "info");
		await ensureSandcastleCliScaffold(cwd, cfg, { runIssueTrackerSetup: true });
	} else if (scaffoldSetupNeedsReinit(cwd, cfg)) {
		notify?.("Sandcastle setup settings changed; reinitializing .sandcastle/ before rebuilding the sandbox image.", "info");
		await ensureSandcastleCliScaffold(cwd, cfg, { reinitialize: true, runIssueTrackerSetup: true });
	}
	ensureSandboxContainerfile(cwd, provider, notify);
}

async function buildSandboxImage(cwd: string, provider: "docker" | "podman", imageName: string): Promise<void> {
	requireSandcastleCliScaffold(cwd);
	await buildSandcastleImage({ cwd, provider, imageName });
}

async function buildSandboxImageOnce(
	cwd: string,
	provider: "docker" | "podman",
	imageName: string,
	build: (cwd: string, provider: "docker" | "podman", imageName: string) => Promise<void>,
): Promise<void> {
	const key = `${cwd}\0${provider}\0${imageName}`;
	const existing = inFlightImageBuilds.get(key);
	if (existing) return existing;
	const next = build(cwd, provider, imageName).finally(() => inFlightImageBuilds.delete(key));
	inFlightImageBuilds.set(key, next);
	return next;
}

async function quietlyBuildConfiguredImage(cwd: string, cfg: Partial<SandcastleConfig>, deps: SandboxImageDeps | undefined): Promise<void> {
	const provider = imageProviderForSandbox(cfg.defaultSandbox);
	if (!provider || !existsSync(join(cwd, ".sandcastle"))) return;
	const imageName = defaultSandcastleImageName(cwd, cfg.imageNamePattern);
	try {
		await buildSandboxImageOnce(cwd, provider, imageName, deps?.buildImage || buildSandboxImage);
	} catch {
		// Silent by design: config saves should not become image-build UX unless the user explicitly runs /work:build-image.
	}
}

async function ensureSandboxImage(
	cwd: string,
	sandbox: AgentDef["sandbox"],
	deps: SandboxImageDeps | undefined,
	onBuild?: (reason: "missing" | "stale", imageName: string) => void,
	cfg?: Partial<SandcastleConfig>,
): Promise<void> {
	const provider = imageProviderForSandbox(sandbox);
	if (!provider) return;
	if (!existsSync(join(cwd, ".sandcastle"))) return;
	const imageName = defaultSandcastleImageName(cwd, cfg?.imageNamePattern);
	const inspect = deps?.inspectImageCreated || inspectImageCreated;
	const build = deps?.buildImage || buildSandboxImage;
	const created = await inspect(cwd, provider, imageName);
	const latestConfigMtime = latestMtimeMs(join(cwd, ".sandcastle"));
	const stale = created && latestConfigMtime !== undefined && latestConfigMtime > created.getTime();
	if (!created || stale) {
		onBuild?.(created ? "stale" : "missing", imageName);
		await buildSandboxImageOnce(cwd, provider, imageName, build);
	}
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
	pi.registerCommand("work:run", {
		description: "Run one configured Role: /work:run [role] [prompt]",
		getArgumentCompletions: (prefix: string) => completionItems(listRuntimeAgents(loadExecutionRuntimePack()).map((agent) => ({ value: agent.name, label: agent.name, description: agent.description })), tokenAfterLastSpace(prefix)),
		handler: async (args, ctx) => {
			if ((deps as any).isConfigImageRebuildInProgress?.()) {
				ctx.ui.notify("The sandbox image is being rebuilt after config changes. Retry /work:run when the new image is built.", "warning");
				return;
			}
			const cfg = await loadConfig(ctx.cwd);
			const { agentName, prompt } = resolveRunInvocation(args, cfg);
			if (!agentName) {
				ctx.ui.notify("No Roles are configured. Run /work:config init, then edit .pi/sandcastle/config.yaml.", "error");
				return;
			}
			if (!prompt) {
				ctx.ui.notify("Usage: /work:run [agent] <prompt>", "error");
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
				kind: DIRECT_ROLE_RUN_KIND,
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

			let hostPiRuntime: HostPiAgentRuntime | undefined;
			try {
				hostPiRuntime = runSettings.provider === "pi" ? createHostPiAgentRuntime() : undefined;
				await ensureSandboxImage(ctx.cwd, runSettings.sandbox, deps.image, (reason, imageName) => {
					ctx.ui.notify(`Execution image ${imageName} is ${reason}; rebuilding before /work:run.`, "info");
				}, cfg);
				const result = await sandcastle.run({
					agent: hostPiRuntime ? createAgentProviderForRuntime(runSettings.model, runSettings.provider, { hostPiRuntime, sandbox: runSettings.sandbox }) : sandcastle.makeAgent(runSettings.model, runSettings.provider),
					sandbox: hostPiRuntime ? resolveSandboxProvider(runSettings.sandbox, hostPiSandboxOptions(ctx.cwd, cfg, hostPiRuntime)) : sandcastle.makeSandbox(runSettings.sandbox),
					cwd: ctx.cwd,
					prompt,
					maxIterations: 1,
					name: `backlog-run:${id}`,
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
			} finally {
				if (hostPiRuntime?.dir) rmSync(hostPiRuntime.dir, { recursive: true, force: true });
			}
		},
	});
}

interface PipelineRunStepRecord {
	index: number;
	role: string;
	status: "running" | "completed" | "failed";
	maxIterations?: number;
	branch?: string;
	commits: string[];
	logPath: string;
	error?: string;
	kind?: string;
	nodePath?: string;
	laneId?: string;
	itemId?: string;
}

interface PipelineRunNodeRecord {
	nodePath: string;
	kind: string;
	status: "completed" | "failed";
	resultType?: string;
	role?: string;
	branch?: string;
	worktreePath?: string;
	commits?: string[];
	logPath?: string;
	effects?: string[];
	mergedBranches?: string[];
	mergedCommits?: string[];
	laneId?: string;
	itemId?: string;
}

interface PipelineRunRecord {
	id: string;
	kind?: "pipeline";
	pipeline: string;
	prompt: string;
	status: "running" | "completed" | "failed";
	branchStrategy: PipelineBranchStrategy;
	executor?: "legacy-steps" | "graph";
	branch?: string;
	worktreePath?: string;
	logDir: string;
	recordPath: string;
	startedAt: string;
	completedAt?: string;
	steps: PipelineRunStepRecord[];
	nodes?: PipelineRunNodeRecord[];
	result?: Record<string, unknown>;
	error?: string;
}

interface GitCommandResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

type GitCommandRunner = (args: string[], options: { cwd: string }) => GitCommandResult | Promise<GitCommandResult>;

interface PipelineExecutionDeps {
	createWorktree?: typeof createWorktree;
	claudeCode?: typeof claudeCode;
	makeAgent?: (model: string, provider?: AgentDef["provider"]) => any;
	loadSandboxProvider?: (kind: AgentDef["sandbox"] | undefined, options?: Record<string, unknown>) => Promise<any>;
	runGit?: GitCommandRunner;
	onStepUpdate?: (step: PipelineRunStepRecord, record: PipelineRunRecord) => void;
	onStepStreamEvent?: (step: PipelineRunStepRecord, event: unknown, record: PipelineRunRecord) => void;
	image?: SandboxImageDeps;
	now?: () => number;
	forceLegacy?: boolean;
	graphInput?: unknown;
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

async function loadPipelineSandboxProvider(kind: AgentDef["sandbox"] | undefined, options?: Record<string, unknown>): Promise<any> {
	if (kind === "podman") return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/podman.js")).podman(options as any);
	if (kind === "vercel") return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/vercel.js")).vercel();
	if (kind === "no-sandbox") return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/no-sandbox.js")).noSandbox();
	return (await import("../../node_modules/@ai-hero/sandcastle/dist/sandboxes/docker.js")).docker(options as any);
}

async function writePipelineRunRecord(record: PipelineRunRecord): Promise<void> {
	mkdirSync(dirname(record.recordPath), { recursive: true });
	writeFileSync(record.recordPath, JSON.stringify(record, null, 2));
}

function pipelineHasGraphNodes(pipeline: PipelineDef): boolean {
	return pipeline.kind === "composite" && Boolean(pipeline.nodes && Object.keys(pipeline.nodes).length > 0);
}

function nodeResultStringArray(result: NodeResult, key: "commits" | "effects"): string[] {
	const value = (result as any)[key];
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function nodeResultRepositoryEffects(result: NodeResult): string[] {
	return nodeResultStringArray(result, "effects").filter((effect) => !isLogArtifactEffect(effect));
}

function isLogArtifactEffect(value: string): boolean {
	return /^(log|logs|logPath|logFilePath)(:|=|$)/i.test(value.trim());
}

function nodeResultLogPath(result: NodeResult): string | undefined {
	const logPath = (result as any).logPath;
	return typeof logPath === "string" && logPath.length ? logPath : undefined;
}

function nodeResultBranch(result: NodeResult): string | undefined {
	const branch = (result as any).branch;
	return typeof branch === "string" && branch.length ? branch : undefined;
}

function nodeResultString(result: NodeResult, key: string): string | undefined {
	const value = (result as any)[key];
	return typeof value === "string" && value.length ? value : undefined;
}

function graphResultHasEffects(result: NodeResult): boolean {
	if (nodeResultStringArray(result, "commits").length || nodeResultRepositoryEffects(result).length) return true;
	if (result.type === "CompositeResult" || result.type === "WorkspaceResult") return Object.values((result as any).children || {}).some((child) => graphResultHasEffects(child as NodeResult));
	if (result.type === "LoopResult") return ((result as any).iterations || []).some((child: NodeResult) => graphResultHasEffects(child));
	return false;
}

function graphLoopItem(context: GraphNodeExecutionContext): Record<string, unknown> | undefined {
	return isRecord(context.loop?.item) ? context.loop?.item as Record<string, unknown> : undefined;
}

function graphExecutionContextItem(context: GraphNodeExecutionContext): Record<string, unknown> | undefined {
	const item = graphLoopItem(context);
	if (typeof item?.branch === "string" && item.branch.length) return item;
	const itemId = typeof item?.itemId === "string" && item.itemId.length ? item.itemId : typeof item?.id === "string" && item.id.length ? item.id : undefined;
	if (!itemId) return undefined;
	const input = isRecord(context.input) ? context.input as Record<string, unknown> : undefined;
	const executionContexts = Array.isArray(input?.executionContexts) ? input.executionContexts : [];
	return executionContexts.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry.itemId === itemId);
}

function graphContextString(context: GraphNodeExecutionContext, key: string): string | undefined {
	const value = graphExecutionContextItem(context)?.[key] ?? graphLoopItem(context)?.[key];
	return typeof value === "string" && value.length ? value : undefined;
}

function graphWorkspaceString(context: GraphNodeExecutionContext, key: string): string | undefined {
	const value = isRecord(context.workspace) ? context.workspace[key] : undefined;
	return typeof value === "string" && value.length ? value : undefined;
}

function collectGraphResultStringArray(result: NodeResult, key: "commits" | "effects"): string[] {
	const own = nodeResultStringArray(result, key);
	if (result.type === "CompositeResult" || result.type === "WorkspaceResult") return [...own, ...Object.values((result as any).children || {}).flatMap((child) => collectGraphResultStringArray(child as NodeResult, key))];
	if (result.type === "LoopResult") return [...own, ...((result as any).iterations || []).flatMap((child: NodeResult) => collectGraphResultStringArray(child, key))];
	return own;
}

function graphStatusNodePath(context: GraphNodeExecutionContext): string {
	if (context.loop) return context.path.replace(/\.node(?=\.|$)/, `.iterations.${context.loop.index}`);
	return context.path;
}

function graphResultSummary(result: NodeResult): Record<string, unknown> {
	return {
		type: result.type,
		status: result.status,
		nodeId: result.nodeId,
		kind: result.kind,
		effects: nodeResultStringArray(result, "effects"),
		commits: nodeResultStringArray(result, "commits"),
	};
}

function collectGraphNodeRecords(result: NodeResult, path = "root"): PipelineRunNodeRecord[] {
	const record: PipelineRunNodeRecord = {
		nodePath: path,
		kind: result.kind,
		status: result.status === "succeeded" ? "completed" : "failed",
		resultType: result.type,
		...(nodeResultString(result, "role") ? { role: nodeResultString(result, "role") } : {}),
		...(nodeResultBranch(result) ? { branch: nodeResultBranch(result) } : {}),
		...(nodeResultString(result, "worktreePath") ? { worktreePath: nodeResultString(result, "worktreePath") } : {}),
		...(nodeResultStringArray(result, "commits").length ? { commits: nodeResultStringArray(result, "commits") } : {}),
		...(nodeResultLogPath(result) ? { logPath: nodeResultLogPath(result) } : {}),
		...(nodeResultStringArray(result, "effects").length ? { effects: nodeResultStringArray(result, "effects") } : {}),
		...(Array.isArray((result as any).mergedBranches) ? { mergedBranches: (result as any).mergedBranches.filter((entry: unknown): entry is string => typeof entry === "string" && entry.length > 0) } : {}),
		...(Array.isArray((result as any).mergedCommits) ? { mergedCommits: (result as any).mergedCommits.filter((entry: unknown): entry is string => typeof entry === "string" && entry.length > 0) } : {}),
		...(nodeResultString(result, "laneId") ? { laneId: nodeResultString(result, "laneId") } : {}),
		...(nodeResultString(result, "itemId") ? { itemId: nodeResultString(result, "itemId") } : {}),
	};
	const children: PipelineRunNodeRecord[] = [];
	if (result.type === "CompositeResult" || result.type === "WorkspaceResult") {
		for (const [id, child] of Object.entries((result as any).children || {})) children.push(...collectGraphNodeRecords(child as NodeResult, `${path}.nodes.${id}`));
	}
	if (result.type === "LoopResult") {
		for (const [index, child] of ((result as any).iterations || []).entries()) children.push(...collectGraphNodeRecords(child as NodeResult, `${path}.iterations.${index}`));
	}
	return [record, ...children];
}

interface GraphMergeCandidate {
	need: string;
	nodeId: string;
	branch: string;
	commits: string[];
}

function defaultRunGit(args: string[], options: { cwd: string }): GitCommandResult {
	const result = spawnSync("git", args, { cwd: options.cwd, encoding: "utf8", env: process.env });
	return {
		status: result.status,
		stdout: result.stdout || "",
		stderr: result.stderr || (result.error ? result.error.message : ""),
	};
}

async function runGraphGit(deps: PipelineExecutionDeps, cwd: string, args: string[]): Promise<GitCommandResult> {
	return await (deps.runGit || defaultRunGit)(args, { cwd });
}

async function assertGraphGit(deps: PipelineExecutionDeps, cwd: string, args: string[], description: string): Promise<string> {
	const result = await runGraphGit(deps, cwd, args);
	if (result.status !== 0) throw new Error(`${description} failed: ${(result.stderr || result.stdout || `git ${args.join(" ")}`).trim()}`);
	return result.stdout.trim();
}

function collectWorkspaceMergeCandidates(needs: Record<string, NodeResult>, inputNames?: string[]): GraphMergeCandidate[] {
	const candidates: GraphMergeCandidate[] = [];
	const entries = inputNames?.length ? inputNames.map((name) => [name, needs[name]] as const) : Object.entries(needs);
	for (const [need, result] of entries) if (result) collectWorkspaceMergeCandidatesFromResult(need, result, candidates);
	return candidates;
}

function collectWorkspaceMergeCandidatesFromResult(need: string, result: NodeResult, candidates: GraphMergeCandidate[]): void {
	if (result.type === "WorkspaceResult") {
		const commits = nodeResultStringArray(result, "commits");
		const effects = nodeResultRepositoryEffects(result);
		if (!commits.length && !effects.length) return;
		const branch = nodeResultBranch(result);
		if (!branch) throw new Error(`git.merge requires mergeable branches; '${need}' produced no branch`);
		candidates.push({ need, nodeId: result.nodeId, branch, commits });
		return;
	}
	if (result.type === "LoopResult") {
		for (const [index, child] of (((result as any).mergeableResults || []) as NodeResult[]).entries()) collectWorkspaceMergeCandidatesFromResult(`${need}[${index}]`, child, candidates);
	}
}

async function mergeGraphWorkspaceBranches(
	context: GraphNodeExecutionContext,
	deps: PipelineExecutionDeps,
	targetCwd: string,
): Promise<Partial<GitMergeResult>> {
	const mergeInputs = Array.isArray((context.node as any).inputs) ? (context.node as any).inputs.filter((entry: unknown): entry is string => typeof entry === "string" && entry.length > 0) : undefined;
	const candidates = collectWorkspaceMergeCandidates(context.needs, mergeInputs);
	if (!candidates.length) throw new Error(`${context.path} requires effectful mergeable branches`);
	await assertGraphGit(deps, targetCwd, ["rev-parse", "--show-toplevel"], `${context.path} git repository check`);
	const targetBranch = await assertGraphGit(deps, targetCwd, ["rev-parse", "--abbrev-ref", "HEAD"], `${context.path} target branch check`);
	let previousHead = await assertGraphGit(deps, targetCwd, ["rev-parse", "HEAD"], `${context.path} target HEAD check`);
	const startHead = previousHead;
	const mergedBranches: string[] = [];
	const mergedCommits: string[] = [];
	const effects: string[] = [];

	for (const candidate of candidates) {
		const result = await runGraphGit(deps, targetCwd, ["merge", "--no-ff", "--no-edit", candidate.branch]);
		if (result.status !== 0) {
			await runGraphGit(deps, targetCwd, ["merge", "--abort"]);
			throw new Error(`${context.path} failed to merge '${candidate.branch}' into '${targetBranch}': ${(result.stderr || result.stdout || "merge conflict").trim()}`);
		}
		const nextHead = await assertGraphGit(deps, targetCwd, ["rev-parse", "HEAD"], `${context.path} post-merge HEAD check`);
		if (nextHead !== previousHead) {
			mergedBranches.push(candidate.branch);
			mergedCommits.push(nextHead);
			effects.push(`merge:${candidate.branch}`);
			for (const commit of candidate.commits) effects.push(`commit:${commit}`);
		}
		previousHead = nextHead;
	}

	if (previousHead === startHead || !effects.length) throw new Error(`${context.path} completed without merge effects`);
	return {
		branch: targetBranch,
		merged: mergedBranches,
		mergedBranches,
		mergedCommits,
		commits: mergedCommits,
		effects,
	};
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
	const useGraphExecutor = !deps.forceLegacy && pipelineHasGraphNodes(pipeline);
	const createWorktreeImpl = deps.createWorktree || createWorktree;
	const makePipelineAgent = deps.makeAgent;
	const loadSandboxProvider = deps.loadSandboxProvider || loadPipelineSandboxProvider;
	const record: PipelineRunRecord = {
		id,
		kind: PIPELINE_RUN_KIND,
		pipeline: pipelineName,
		prompt,
		status: "running",
		branchStrategy,
		executor: useGraphExecutor ? "graph" : "legacy-steps",
		logDir,
		recordPath,
		startedAt: new Date(startedAtMs).toISOString(),
		steps: [],
	};
	let worktree: Awaited<ReturnType<typeof createWorktreeImpl>> | undefined;

	try {
		if (!useGraphExecutor) {
			worktree = await createWorktreeImpl({
				cwd,
				branchStrategy,
				copyToWorktree: pipeline.copyToWorktree,
			});
			record.branch = worktree.branch;
			record.worktreePath = worktree.worktreePath;
		}
		await writePipelineRunRecord(record);

		if (useGraphExecutor) {
			const runAgentNode = async (context: GraphNodeExecutionContext) => {
				const node = context.node as PipelineNodeDef;
				const roleName = node.role;
				const workspaceWorktree = isRecord(context.workspace) ? (context.workspace.worktree as any) : undefined;
				if (!workspaceWorktree || typeof workspaceWorktree.run !== "function") throw new Error(`${context.path} agent node must execute inside git.worktree`);
				const contextBranch = graphContextString(context, "branch") || graphWorkspaceString(context, "branch");
				const itemId = graphContextString(context, "itemId");
				const nodePath = graphStatusNodePath(context);
				const laneId = graphContextString(context, "contextId") || (context.loop ? `${nodePath}:${context.loop.index}` : undefined);
				const contextPromptPrefix = graphLoopItem(context) ? `Execution context: ${laneId || "unknown"}${itemId ? `\nWork Item: ${itemId}` : ""}${contextBranch ? `\nBranch: ${contextBranch}` : ""}\n\n` : "";
				if (!roleName) throw new Error(`${context.path} agent node must reference a role`);
				const role = cfg.agents[roleName];
				if (!role) throw new Error(`${context.path} references unknown role '${roleName}'`);
				const stepRecord: PipelineRunStepRecord = {
					index: record.steps.length,
					role: roleName,
					status: "running",
					maxIterations: Number.isInteger((node as any).maxIterations) ? Number((node as any).maxIterations) : cfg.maxIterations || 10,
					commits: [],
					logPath: buildPipelineStepLogPath(logDir, record.steps.length, roleName),
					kind: node.kind,
					nodePath,
					...(contextBranch ? { branch: contextBranch } : {}),
					...(itemId ? { itemId } : {}),
					...(laneId ? { laneId } : {}),
				};
				record.steps.push(stepRecord);
				await writePipelineRunRecord(record);
				deps.onStepUpdate?.(stepRecord, record);

				const sandboxKind = (node as any).sandbox || role.sandbox || pipeline.sandbox || cfg.defaultSandbox || DEFAULT_SANDBOX;
				await ensureSandboxImage(cwd, sandboxKind, deps.image, undefined, cfg);
				const provider = role.provider || cfg.defaultAgent || "pi";
				const model = resolvePipelineModelForProvider((node as any).model || role.model || pipeline.model || cfg.defaultModel, provider);
				const hostPiRuntime = provider === "pi" ? createHostPiAgentRuntime() : undefined;
				try {
					const sandbox = await loadSandboxProvider(sandboxKind, hostPiRuntime ? hostPiSandboxOptions(cwd, cfg, hostPiRuntime) : { imageName: defaultSandcastleImageName(cwd, cfg.imageNamePattern) });
					const template = node.promptOverride || resolvePromptText(cfg, node.prompt || "$INPUT");
					const stepPromptBody = `${contextPromptPrefix}${resolvePipelineStepPrompt(template, prompt, prompt)}`;
					const stepPrompt = role.systemPrompt ? `${role.systemPrompt}\n\n## Delegated task\n\n${stepPromptBody}` : stepPromptBody;
					const result = await workspaceWorktree.run({
						agent: makePipelineAgent ? makePipelineAgent(model, provider) : createAgentProviderForRuntime(model, provider, { hostPiRuntime, sandbox: sandboxKind, claudeCodeFactory: deps.claudeCode }),
						sandbox,
						prompt: stepPrompt,
						maxIterations: stepRecord.maxIterations,
						logging: {
							type: "file",
							path: stepRecord.logPath,
							verbose: true,
							onAgentStreamEvent: (event: unknown) => deps.onStepStreamEvent?.(stepRecord, event, record),
						},
					});

					const commitShas = getPipelineCommitShas(result.commits);
					const resultBranch = contextBranch || result.branch;
					stepRecord.status = "completed";
					stepRecord.branch = resultBranch;
					stepRecord.commits = commitShas;
					record.branch = resultBranch || record.branch;
					stepRecord.logPath = result.logFilePath || stepRecord.logPath;
					await writePipelineRunRecord(record);
					deps.onStepUpdate?.(stepRecord, record);
					return {
						role: roleName,
						branch: resultBranch,
						commits: commitShas,
						logPath: result.logFilePath,
						stdout: result.stdout,
						...(itemId ? { itemId } : {}),
						...(laneId ? { laneId } : {}),
					};
				} catch (error) {
					stepRecord.status = "failed";
					stepRecord.error = error instanceof Error ? error.message : String(error);
					await writePipelineRunRecord(record);
					deps.onStepUpdate?.(stepRecord, record);
					throw error;
				} finally {
					if (hostPiRuntime?.dir) rmSync(hostPiRuntime.dir, { recursive: true, force: true });
				}
			};
			const graphResult = await executeGraphWorkflow({ kind: "composite", nodes: pipeline.nodes } as GraphWorkflowNode, {
				input: deps.graphInput ?? prompt,
				handlers: {
					agent: runAgentNode,
					"agent.pi": runAgentNode,
					script: async ({ node }) => ({ output: (node as any).run || (node as any).command || (node as any).with?.run }),
					"git.worktree": async (context) => {
						if (!context.executeChildren) throw new Error(`${context.path} cannot execute git.worktree children`);
						const contextBranch = graphContextString(context, "branch");
						const workspaceBranchStrategy: PipelineBranchStrategy = contextBranch
							? {
								type: "branch",
								branch: contextBranch,
								...(branchStrategy.type === "branch" && branchStrategy.baseBranch ? { baseBranch: branchStrategy.baseBranch } : {}),
							}
							: branchStrategy;
						const laneWorktree = await createWorktreeImpl({
							cwd,
							branchStrategy: workspaceBranchStrategy,
							copyToWorktree: pipeline.copyToWorktree,
						});
						try {
							const workspaceBranch = contextBranch || laneWorktree.branch;
							const childRun = await context.executeChildren({
								workspace: {
									branch: workspaceBranch,
									worktreePath: laneWorktree.worktreePath,
									worktree: laneWorktree,
								},
							});
							const childResults = Object.values(childRun.children) as NodeResult[];
							const commits = childResults.flatMap((child) => collectGraphResultStringArray(child, "commits"));
							const childEffects = childResults.flatMap((child) => collectGraphResultStringArray(child, "effects")).filter((effect) => !isLogArtifactEffect(effect));
							const itemId = graphContextString(context, "itemId");
							const nodePath = graphStatusNodePath(context);
							const laneId = graphContextString(context, "contextId") || (context.loop ? `${nodePath}:${context.loop.index}` : undefined);
							record.branch = record.branch || workspaceBranch;
							record.worktreePath = record.worktreePath || laneWorktree.worktreePath;
							return {
								branch: workspaceBranch,
								worktreePath: laneWorktree.worktreePath,
								commits,
								effects: [...commits.map((commit) => `commit:${commit}`), ...childEffects],
								children: childRun.children,
								order: childRun.order,
								...(itemId ? { itemId } : {}),
								...(laneId ? { laneId } : {}),
							};
						} finally {
							await laneWorktree.close().catch(() => undefined);
						}
					},
					"git.merge": async (context) => mergeGraphWorkspaceBranches(context, deps, worktree?.worktreePath || cwd),
				},
			}) as CompositeResult;
			record.nodes = collectGraphNodeRecords(graphResult);
			record.result = graphResultSummary(graphResult);
			if (!graphResultHasEffects(graphResult)) throw new Error("Graph pipeline completed without effects");
			record.status = "completed";
			record.completedAt = new Date(now()).toISOString();
			await writePipelineRunRecord(record);
			return record;
		}

		let input = prompt;
		for (const [index, step] of pipeline.steps.entries()) {
			const stepRecord: PipelineRunStepRecord = {
				index,
				role: step.role,
				status: "running",
				maxIterations: step.maxIterations || cfg.maxIterations || 10,
				commits: [],
				logPath: buildPipelineStepLogPath(logDir, index, step.role),
			};
			record.steps.push(stepRecord);
			await writePipelineRunRecord(record);
			deps.onStepUpdate?.(stepRecord, record);

			const sandboxKind = step.sandbox || pipeline.sandbox || cfg.defaultSandbox || DEFAULT_SANDBOX;
			await ensureSandboxImage(cwd, sandboxKind, deps.image, undefined, cfg);
			const role = cfg.agents[step.role];
			const provider = role?.provider || cfg.defaultAgent || "pi";
			const model = resolvePipelineModelForProvider(step.model || role?.model || pipeline.model || cfg.defaultModel, provider);
			const hostPiRuntime = provider === "pi" ? createHostPiAgentRuntime() : undefined;
			try {
				const sandbox = await loadSandboxProvider(sandboxKind, hostPiRuntime ? hostPiSandboxOptions(cwd, cfg, hostPiRuntime) : { imageName: defaultSandcastleImageName(cwd, cfg.imageNamePattern) });
				const stepPromptBody = resolvePipelineStepPrompt(step.promptOverride || resolvePromptText(cfg, step.prompt), input, prompt);
				const stepPrompt = role?.systemPrompt ? `${role.systemPrompt}\n\n## Delegated task\n\n${stepPromptBody}` : stepPromptBody;
				const result = await worktree.run({
					agent: makePipelineAgent ? makePipelineAgent(model, provider) : createAgentProviderForRuntime(model, provider, { hostPiRuntime, sandbox: sandboxKind, claudeCodeFactory: deps.claudeCode }),
					sandbox,
				prompt: stepPrompt,
				maxIterations: step.maxIterations || cfg.maxIterations || 10,
				logging: {
					type: "file",
					path: stepRecord.logPath,
					verbose: true,
					onAgentStreamEvent: (event: unknown) => deps.onStepStreamEvent?.(stepRecord, event, record),
				},
				});

				const commitShas = getPipelineCommitShas(result.commits);
				stepRecord.status = "completed";
				stepRecord.branch = result.branch;
				stepRecord.commits = commitShas;
				record.branch = result.branch || record.branch;
				stepRecord.logPath = result.logFilePath || stepRecord.logPath;
				input = summarizePipelineStepResult(pipelineName, step.role, result.branch, commitShas, stepRecord.logPath);
				await writePipelineRunRecord(record);
				deps.onStepUpdate?.(stepRecord, record);
			} finally {
				if (hostPiRuntime?.dir) rmSync(hostPiRuntime.dir, { recursive: true, force: true });
			}
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
			deps.onStepUpdate?.(lastStep, record);
		}
		await writePipelineRunRecord(record);
		throw error;
	} finally {
		await worktree?.close().catch(() => undefined);
	}
}

function formatRunStateLine(run: RunState): string {
	const details = [
		run.itemId ? `item ${run.itemId}` : undefined,
		run.nodePath ? `node ${run.nodePath}` : undefined,
		run.laneId ? `lane ${run.laneId}` : undefined,
	].filter((entry): entry is string => Boolean(entry));
	const statusText = run.lastLine || run.task.slice(0, 48);
	return details.length ? `${details.join("; ")}; ${statusText}` : statusText;
}

function renderWidget(runs: Map<string, RunState>): string[] {
	const active = [...runs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 8);
	const lines = [`Execution workers: ${runs.size}`];
	for (const run of active) {
		const ageSource = run.endedAt || Date.now();
		const age = Math.max(0, Math.round((ageSource - run.startedAt) / 1000));
		const commits = run.commits?.length ? ` · ${run.commits.length} commit(s)` : "";
		lines.push(`${run.status.padEnd(9)} ${run.agent.padEnd(12)} ${age}s · ${formatRunStateLine(run)}${commits}`);
	}
	return lines;
}

function statusTextValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	if (Array.isArray(value)) return value.map(statusTextValue).filter(Boolean).join(" ");
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of ["text", "message", "content", "delta", "partial"]) {
			const nested = statusTextValue(record[key]);
			if (nested) return nested;
		}
		return JSON.stringify(value);
	}
	return String(value);
}

function compactStatusText(text: unknown, max = 120): string {
	const compact = statusTextValue(text).replace(/\s+/g, " ").trim();
	return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function formatAgentStreamStatus(event: any, maxIterations?: number): string | undefined {
	if (!event || typeof event !== "object") return undefined;
	const iteration = Number.isFinite(event.iteration) ? Number(event.iteration) : undefined;
	const iterationPrefix = iteration ? `iter ${iteration}${maxIterations ? `/${maxIterations}` : ""}: ` : "";
	if (event.type === "toolCall") return `${iterationPrefix}tool: ${event.name || "tool"}`;
	if (event.type === "text") return `${iterationPrefix}${compactStatusText(event.message || event.text || "", 120)}`;
	if (event.type === "raw") {
		const raw = String(event.line || event.text || "").trim();
		if (raw.startsWith("{")) {
			try {
				const parsed = JSON.parse(raw);
				const nestedType = parsed.assistantMessageEvent?.type || parsed.type;
				if (["thinking_start", "message_start", "message_update"].includes(nestedType)) return undefined;
				const text = parsed.text || parsed.message || parsed.assistantMessageEvent?.text || parsed.delta?.text;
				return text ? `${iterationPrefix}${compactStatusText(text, 120)}` : undefined;
			} catch {
				return undefined;
			}
		}
		return `${iterationPrefix}${compactStatusText(raw, 120)}`;
	}
	return undefined;
}

function completionItems(values: Array<string | SelectItem>, prefix: string): SelectItem[] | null {
	const items = values.map((value) => typeof value === "string" ? { value, label: value } : value);
	const filtered = items.filter((item) => item.value.startsWith(prefix) || item.label.startsWith(prefix));
	return filtered.length ? filtered : null;
}

function pipelineCompletionItems(prefix: string): SelectItem[] | null {
	return completionItems(listRuntimePipelines(loadExecutionRuntimePack()).map((pipeline) => ({ value: pipeline.name, label: pipeline.name, description: pipeline.description })), prefix);
}

function flagCompletionItems(flags: string[], prefix: string): SelectItem[] | null {
	return completionItems(flags, prefix);
}

function scConfigTopLevelItems(): SelectItem[] {
	return [
		{ value: "init", label: "init", description: "hydrate missing config and runner files" },
		{ value: "init --force", label: "init --force", description: "overwrite config and runner with defaults" },
		{ value: "show", label: "show", description: "display effective config" },
		{ value: "edit", label: "edit", description: "open config in terminal editor" },
		{ value: "editor", label: "editor", description: "show preferred editor" },
		{ value: "get", label: "get", description: "read a schema-backed config path" },
		{ value: "set", label: "set", description: "set a supported config path" },
		{ value: "reset", label: "reset", description: "reset a supported config path" },
		{ value: "validate", label: "validate", description: "validate repo-local config" },
	];
}

function nestedConfigPathItems(pathPrefix: string): SelectItem[] {
	const leaves = configuredConfigPaths(DEFAULT_CONFIG);
	const nodes = new Set<string>();
	for (const leaf of leaves) {
		const parts = leaf.split(".");
		for (let index = 1; index < parts.length; index++) nodes.add(`${parts.slice(0, index).join(".")}.`);
	}
	const values = [...new Set([...nodes, ...leaves])].sort();
	return values
		.filter((value) => value.startsWith(pathPrefix) && value !== pathPrefix)
		.map((value) => {
			const trimmed = value.endsWith(".") ? value.slice(0, -1) : value;
			return { value, label: value.endsWith(".") ? `${trimmed.split(".").pop()}.` : trimmed.split(".").pop() || value, description: value.endsWith(".") ? "config section" : value };
		});
}

function scConfigPathCompletions(subcommand: string, pathPrefix: string): SelectItem[] | null {
	const items = nestedConfigPathItems(pathPrefix).map((item) => ({ ...item, value: `${subcommand} ${item.value}` }));
	return completionItems(items, `${subcommand} ${pathPrefix}`);
}

function scConfigCompletionItems(prefix: string): SelectItem[] | null {
	const trimmedStart = prefix.trimStart();
	const hasTrailingSpace = /\s$/.test(trimmedStart);
	const parts = trimmedStart.split(/\s+/).filter(Boolean);
	if (parts.length === 0 || (parts.length === 1 && !hasTrailingSpace)) {
		return completionItems(scConfigTopLevelItems(), parts[0] || "");
	}
	const [subcommand, path = "", valuePrefix = ""] = parts;
	if (["get", "reset"].includes(subcommand) && parts.length <= 2) {
		return scConfigPathCompletions(subcommand, path);
	}
	if (subcommand === "set") {
		if (parts.length <= 2 && !hasTrailingSpace) return scConfigPathCompletions("set", path);
		const enums = schemaEnumForPath(path);
		if (enums?.length) return completionItems(enums.map((entry) => ({ value: `set ${path} ${entry}`, label: entry })), `set ${path} ${valuePrefix}`);
	}
	if (subcommand === "editor" && parts.length <= 2) {
		return completionItems(["nvim", "vim", "nano", "code --wait", "emacs"].map((editor) => ({ value: `editor ${editor}`, label: editor })), `editor ${parts[1] || ""}`);
	}
	return null;
}

function tokenAfterLastSpace(value: string): string {
	const match = value.match(/(?:^|\s)(\S*)$/);
	return match?.[1] || "";
}

function isTuiForceQuit(data: string): boolean {
	return data === "\x11" || data.toLowerCase() === "ctrl+q" || data.toLowerCase() === "control+q";
}

function isTuiEscape(data: string): boolean {
	return matchesKey(data, "escape") || data === "\x1b\x1b" || data.toLowerCase() === "escape";
}

function isDefaultableConfigPath(path: string): boolean {
	const parts = splitConfigPath(path);
	return (parts.length === 3 && ["roles", "pipelines"].includes(parts[0]) && ["model", "sandbox"].includes(parts[2]))
		|| (parts[0] === "pipelines" && parts[2] === "nodes" && ["model", "sandbox", "maxIterations"].includes(parts.at(-1)!))
		|| (parts[0] === "pipelines" && parts[2] === "steps" && ["model", "sandbox", "maxIterations"].includes(parts[4]));
}

function effectiveDefaultForPath(cfg: SandcastleConfig, path: string): string | undefined {
	const parts = splitConfigPath(path);
	const field = parts.at(-1);
	if (field === "model") return cfg.defaultModel || DEFAULT_MODEL;
	if (field === "sandbox") return cfg.defaultSandbox || DEFAULT_SANDBOX;
	if (field === "maxIterations") return "role default";
	return undefined;
}

function selectableValuesForPath(cfg: SandcastleConfig, path: string): string[] {
	const parts = splitConfigPath(path);
	const values = schemaEnumForPath(path)
		|| (path === "defaultPipeline" ? ["simple-loop", "sequential-reviewer", "parallel-planner", "parallel-planner-with-review", "archive"] : undefined)
		|| (path === "defaultAgent" ? ["claude-code", "pi", "codex", "cursor", "opencode", "copilot"] : undefined)
		|| (path === "workSource" ? ["github-issues", "custom", "beads"] : undefined)
		|| (parts[0] === "pipelines" && parts[2] === "nodes" && parts.at(-1) === "role" ? Object.keys(cfg.agents) : undefined)
		|| (parts[0] === "pipelines" && parts[2] === "steps" && parts[4] === "role" ? Object.keys(cfg.agents) : undefined);
	const withDefault = isDefaultableConfigPath(path) ? ["default", ...(values || [])] : (values || []);
	return [...new Set(withDefault)];
}

function allowsCustomValueForPath(path: string): boolean {
	return !["defaultPipeline", "defaultAgent", "workSource", "issueTracker"].includes(path);
}

function coerceConfigValue(path: string, rawValue: string): unknown {
	const field = splitConfigPath(path).at(-1);
	if (rawValue === "default" && isDefaultableConfigPath(path)) return rawValue;
	if (field === "maxIterations" || field === "maxWorkers") {
		const value = Number(rawValue);
		if (!Number.isInteger(value) || value < 1) throw new Error(`${path} must be a positive integer.`);
		return value;
	}
	return rawValue;
}

type BacklogConfigAction =
	| { type: "init" }
	| { type: "edit" }
	| { type: "validate" }
	| { type: "build-image" }
	| { type: "sandcastle-init" }
	| { type: "set-editor"; editor: string }
	| { type: "set-config"; path: string; value: string }
	| { type: "add-agent"; name: string }
	| { type: "rename-agent"; oldName: string; newName: string }
	| { type: "delete-agent"; name: string }
	| { type: "add-pipeline"; name: string }
	| { type: "rename-pipeline"; oldName: string; newName: string }
	| { type: "delete-pipeline"; name: string }
	| { type: "add-pipeline-step"; pipeline: string }
	| { type: "delete-pipeline-step"; pipeline: string; index: number }
	| { type: "replace-config"; config: SandcastleConfig }
	| { type: "import-config-file" }
	| { type: "apply-pack"; pack: string }
	| { type: "batch"; actions: BacklogConfigAction[]; config?: SandcastleConfig; rebuildImage?: boolean }
	| { type: "cancel" };

function friendlyConfigLabel(pathOrField: string): string {
	const field = pathOrField.split(".").pop() || pathOrField;
	const labels: Record<string, string> = {
		defaultSandbox: "Sandbox",
		defaultModel: "Model",
		defaultPipeline: "Default Pipeline",
		defaultAgent: "Default Agent",
		maxWorkers: "Max Workers",
		maxIterations: "Max Iterations",
		workSource: "Work Source",
		workSourceSetupCommand: "Work Source Setup Command",
		issueTracker: "Issue Tracker (legacy)",
		issueTrackerSetupCommand: "Issue Tracker Setup Command (legacy)",
		imageNamePattern: "Image Name Pattern",
		description: "Description",
		model: "Model",
		sandbox: "Sandbox",
		provider: "Provider",
		maxIterations: "Max Iterations",
		branch: "Branch",
		systemPrompt: "System Prompt",
	};
	return labels[field] || field.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function summarizeValue(value: unknown): string {
	if (Array.isArray(value)) return value.join(", ") || "<empty>";
	if (value === undefined) return "Not set";
	return formatConfigValue(value).replace(/\n/g, "\\n");
}

function describeConfigAction(action: BacklogConfigAction, before: SandcastleConfig, after: SandcastleConfig): string {
	if (action.type === "set-config") return `${friendlyConfigLabel(action.path)}: ${summarizeValue(readConfigValue(before, action.path))} → ${summarizeValue(readConfigValue(after, action.path))}`;
	if (action.type === "replace-config") return "Replace configuration draft";
	if (action.type === "add-pipeline-step") return `Add step: ${action.pipeline}`;
	if (action.type === "delete-pipeline-step") return `Delete step ${action.index + 1}: ${action.pipeline}`;
	if (action.type.startsWith("rename-")) return `${action.type.replace("rename-", "Rename ")}: ${(action as any).oldName} → ${(action as any).newName}`;
	if (action.type.startsWith("add-")) return `${action.type.replace("add-", "Add ")}: ${(action as any).name}`;
	if (action.type.startsWith("delete-")) return `${action.type.replace("delete-", "Delete ")}: ${(action as any).name}`;
	return action.type;
}

function configActionRequiresImageRebuild(action: BacklogConfigAction): boolean {
	if (["init", "apply-pack", "replace-config", "add-agent", "rename-agent", "delete-agent", "add-pipeline", "rename-pipeline", "delete-pipeline", "add-pipeline-step", "delete-pipeline-step"].includes(action.type)) return true;
	if (action.type === "set-config") return action.path !== "workSourceSetupCommand" && action.path !== "issueTrackerSetupCommand";
	if (action.type === "batch") return action.actions.some(configActionRequiresImageRebuild);
	return false;
}

async function showBacklogConfigTui(ctx: any): Promise<BacklogConfigAction | null> {
	const loadError: { message?: string } = {};
	const loadedCfg = await loadConfig(ctx.cwd).catch((error) => {
		loadError.message = error instanceof Error ? error.message : String(error);
		return DEFAULT_CONFIG;
	});
	const imageProvider = imageProviderForSandbox(loadedCfg.defaultSandbox);
	const configuredImageName = defaultSandcastleImageName(ctx.cwd, loadedCfg.imageNamePattern);
	const imageMissingAtOpen = Boolean(imageProvider && !(await inspectImageCreated(ctx.cwd, imageProvider, configuredImageName)));
	let model = new ConfigShadowModel(loadedCfg);
	let cfg: SandcastleConfig = model.value as SandcastleConfig;
	let unsubscribeModel = model.onChange(() => { cfg = model.value as SandcastleConfig; });
	return ctx.ui.custom<BacklogConfigAction | null>((tui: any, theme: any, _kb: any, done: (value: BacklogConfigAction | null) => void) => {
		type Screen = { title: string; subtitle?: string; items: SelectItem[] };
		let route: string[] = ["main"];
		let selected = 0;
		let editPath: string | null = null;
		let editBuffer = "";
		let editChoices: string[] = [];
		let editChoiceIndex = 0;
		let editCustom = false;
		let editAllowCustom = true;
		let textAction: BacklogConfigAction["type"] | null = null;
		let textPayload: Record<string, string> = {};
		let textTitle = "";
		let editCursor = 0;
		let editSelectAll = false;
		let pendingPack = "default";
		let dirty = false;
		const pendingActions: BacklogConfigAction[] = [];

		const pathValue = (path: string): string => {
			const value = readConfigValue(cfg, path);
			return value === undefined ? "" : formatConfigValue(value).replace(/\n/g, "\\n");
		};
		const valueDescription = (path: string) => {
			const parts = splitConfigPath(path);
			const raw = readConfigValue(cfg, path);
			if (parts[0] === "pipelines" && parts[2] === "steps" && parts[4] === "prompt") return promptSummary(String(raw || ""));
			const value = pathValue(path);
			if (value) return value === DEFAULT_MODEL ? "Provider default model" : value;
			if (isDefaultableConfigPath(path)) return `Inherited: ${effectiveDefaultForPath(cfg, path) || "Not set"}`;
			return "Not set";
		};
		const field = (path: string, label = friendlyConfigLabel(path)): SelectItem => ({ value: `field:${path}`, label, description: valueDescription(path) });
		const open = (name: string) => { route = [...route, name]; selected = 0; tui.requestRender(); };
		const replace = (name: string) => { route = [...route.slice(0, -1), name]; selected = 0; tui.requestRender(); };
		const current = () => route[route.length - 1] || "main";

		const mainScreen = (): Screen => ({
			title: "BACKLOG CONFIG BIOS",
			subtitle: "Section editor over .pi/sandcastle/config.yaml",
			items: [
				...(loadError.message ? [{ value: "noop", label: "Config has validation errors", description: loadError.message.slice(0, 120) }] : []),
				{ value: "nav:defaults", label: "Runtime Defaults", description: "Fallback values used when roles or pipelines inherit a setting" },
				{ value: "nav:agents", label: "Roles", description: "Create and configure reusable execution roles" },
				{ value: "nav:pipelines", label: "Pipelines", description: "Configure deterministic workflows and their steps" },
				{ value: "nav:actions", label: "Operations", description: "Validate, import, rebuild, or reset configuration" },
				{ value: "cancel", label: "Exit", description: "Close this configuration editor" },
			],
		});

		const defaultsScreen = (): Screen => ({
			title: "RUNTIME DEFAULTS",
			subtitle: "User-configurable fallback settings; local environment details live under Actions",
			items: [field("defaultSandbox"), field("defaultModel"), field("defaultPipeline"), field("defaultAgent"), field("maxWorkers"), field("maxIterations"), field("workSource"), field("workSourceSetupCommand"), field("imageNamePattern")],
		});

		const agentsScreen = (): Screen => ({
			title: "ROLES",
			subtitle: "Choose a role to edit its fields",
			items: [
				{ value: "text:add-agent", label: "New role", description: "Create a role using global defaults" },
				...Object.entries(cfg.agents).map(([name, agent]) => ({ value: `nav:agent:${name}`, label: name, description: agent.description || agent.model || "configured role" })),
			],
		});

		const agentScreen = (name: string): Screen => ({
			title: `ROLE / ${name}`,
			subtitle: "Common role settings; provider, model, sandbox, and branch are advanced",
			items: [
				{ value: `text:rename-agent:${name}`, label: "Rename role", description: name },
				field(`roles.${name}.description`),
				field(`roles.${name}.maxIterations`),
				field(`roles.${name}.systemPrompt`, "System Prompt"),
				{ value: `nav:agent-advanced:${name}`, label: "Advanced", description: "Provider, model, sandbox, branch, and deletion" },
			],
		});

		const agentAdvancedScreen = (name: string): Screen => ({
			title: `ROLE / ${name} / ADVANCED`,
			subtitle: "Low-level execution settings; leave empty to inherit runtime defaults when possible",
			items: [
				field(`roles.${name}.provider`),
				field(`roles.${name}.model`),
				field(`roles.${name}.sandbox`),
				field(`roles.${name}.branch`, "Branch Override"),
				{ value: `delete-agent:${name}`, label: "Delete role", description: "Remove this role from the config" },
			],
		});

		const pipelinesScreen = (): Screen => ({
			title: "PIPELINES",
			subtitle: "Choose a pipeline for detailed inspection/editing",
			items: [
				{ value: "text:add-pipeline", label: "New pipeline", description: "Create a graph-native worker pipeline" },
				...Object.entries(cfg.pipelines).filter(([name]) => name !== "blank").map(([name, pipeline]) => ({ value: `nav:pipeline:${name}`, label: name, description: pipeline.description || (pipeline.nodes ? "graph composite" : `${pipeline.steps?.length || 0} step(s)`) })),
			],
		});

		const promptSummary = (prompt?: string): string => {
			if (!prompt) return "Not set";
			const resolved = cfg.prompts?.[prompt]?.template || prompt;
			return resolved.split(/\n/).find((line) => line.trim())?.trim().slice(0, 100) || "Not set";
		};

		const graphNodeItems = (pipelineName: string, nodes: Record<string, PipelineNodeDef> | undefined, prefix = `pipelines.${pipelineName}.nodes`, labelPrefix = "Node"): SelectItem[] => {
			if (!nodes) return [];
			return Object.entries(nodes).flatMap(([nodeId, node]) => {
				const nodePrefix = `${prefix}.${nodeId}`;
				const label = `${labelPrefix} ${nodeId}: ${node.kind || "unknown"}`;
				return [
					{ value: `info:${nodePrefix}`, label, description: node.role ? `role ${node.role}` : node.needs?.length ? `needs ${node.needs.join(", ")}` : "Graph node" },
					...(node.role !== undefined ? [field(`${nodePrefix}.role`, `${nodeId} role`)] : []),
					...(node.prompt !== undefined ? [field(`${nodePrefix}.prompt`, `${nodeId} prompt`)] : []),
					...graphNodeItems(pipelineName, node.nodes, `${nodePrefix}.nodes`, `${labelPrefix} ${nodeId}/node`),
					...(node.node ? graphNodeItems(pipelineName, { node: node.node }, nodePrefix, `${labelPrefix} ${nodeId}`) : []),
				];
			});
		};

		const pipelineScreen = (name: string): Screen => {
			const pipeline = cfg.pipelines[name];
			const branch = pipeline?.branchStrategy ? `${pipeline.branchStrategy.type || "branch"}${pipeline.branchStrategy.branch ? ` → ${pipeline.branchStrategy.branch}` : ""}` : "Inherited";
			const isGraph = Boolean(pipeline?.nodes && Object.keys(pipeline.nodes).length);
			const stepItems = isGraph ? [] : (pipeline?.steps || []).map((step, index) => ({
				value: `nav:pipeline-step:${name}:${index}`,
				label: `Step ${index + 1}: ${step.role || "No role selected"}`,
				description: promptSummary(step.prompt),
			}));
			return {
				title: `PIPELINE / ${name}`,
				subtitle: `${isGraph ? "Graph composite" : "Legacy steps"} · Branch strategy: ${branch}`,
				items: [
					{ value: `text:rename-pipeline:${name}`, label: "Rename pipeline", description: name },
					field(`pipelines.${name}.description`),
					field(`pipelines.${name}.model`),
					field(`pipelines.${name}.sandbox`),
					...graphNodeItems(name, pipeline?.nodes),
					...stepItems,
					...(isGraph ? [] : [{ value: `add-pipeline-step:${name}`, label: "Add step", description: "Append a worker step to this legacy pipeline" }]),
					{ value: `delete-pipeline:${name}`, label: "Delete pipeline", description: "Remove this pipeline from the config" },
				],
			};
		};

		const pipelineStepScreen = (pipelineName: string, indexText: string): Screen => {
			const stepIndex = Number(indexText);
			const step = cfg.pipelines[pipelineName]?.steps?.[stepIndex];
			return {
				title: `PIPELINE / ${pipelineName} / STEP ${stepIndex + 1}`,
				subtitle: "Step settings; leave model/sandbox empty to inherit runtime defaults",
				items: [
					field(`pipelines.${pipelineName}.steps.${stepIndex}.role`, "Role"),
					field(`pipelines.${pipelineName}.steps.${stepIndex}.description`),
					field(`pipelines.${pipelineName}.steps.${stepIndex}.model`),
					field(`pipelines.${pipelineName}.steps.${stepIndex}.sandbox`),
					field(`pipelines.${pipelineName}.steps.${stepIndex}.maxIterations`),
					field(`pipelines.${pipelineName}.steps.${stepIndex}.prompt`, "Prompt"),
					{ value: `delete-pipeline-step:${pipelineName}:${stepIndex}`, label: "Delete step", description: `Remove ${step?.role || "this"} step from the pipeline` },
				],
			};
		};

		const actionsScreen = (): Screen => ({
			title: "OPERATIONS",
			subtitle: "Operational commands around config editing",
			items: [
				{ value: "action:validate", label: "Validate Config", description: "Check for missing roles, invalid providers, and pipeline errors" },
				{ value: "action:init", label: "Reset to System Defaults", description: "Restore the default Agent Workflows configuration" },
				{ value: "nav:packs", label: "Import Bundled Template", description: "Replace this draft with a built-in template" },
				{ value: "text:import-config-file", label: "Import Config File", description: "Enter a path to a custom .pi/sandcastle/config.yaml-compatible file" },
				{ value: "action:edit", label: `Edit Config in ${getPreferredEditor(ctx.cwd)}`, description: "Open the current unsaved draft in your preferred editor" },
				{ value: "nav:editors", label: "Preferred Editor", description: "Choose the terminal editor used for raw config editing" },
				{ value: "action:build", label: "Rebuild Sandbox Image", description: "Build the execution container image for this repository" },
			],
		});

		const screen = (): Screen => {
			const key = current();
			if (key === "main") return mainScreen();
			if (key === "defaults") return defaultsScreen();
			if (key === "agents") return agentsScreen();
			if (key.startsWith("agent-advanced:")) return agentAdvancedScreen(key.slice("agent-advanced:".length));
			if (key.startsWith("agent:")) return agentScreen(key.slice("agent:".length));
			if (key === "pipelines") return pipelinesScreen();
			if (key.startsWith("pipeline:")) return pipelineScreen(key.slice("pipeline:".length));
			if (key.startsWith("pipeline-step:")) {
				const [, pipelineName, indexText] = key.split(":");
				return pipelineStepScreen(pipelineName, indexText);
			}
			if (key === "actions") return actionsScreen();
			if (key === "packs") return { title: "IMPORT BUNDLED TEMPLATE", subtitle: "Built-in templates replace the current draft; save on exit to write it", items: listConfigPacks().map((item) => ({ ...item, value: `pack:${item.value}` })) };
			if (key === "confirm-pack") return { title: "CONFIRM IMPORT", subtitle: `Pack: ${pendingPack}`, items: [{ value: "action:apply-pack", label: `Import ${pendingPack}`, description: "Replace the current unsaved draft with this configuration" }, { value: "back", label: "Back", description: "Return to configuration imports" }] };
			if (key === "editors") return { title: "EDITOR SETUP", subtitle: "Choose preferred terminal editor", items: ["nvim", "vim", "nano", "code --wait", "emacs"].map((editor) => ({ value: `editor:${editor}`, label: editor, description: editor === getPreferredEditor(ctx.cwd) ? "current" : undefined })) };
			if (key === "confirm-exit") {
				const needsRebuild = pendingActions.some(configActionRequiresImageRebuild) || imageMissingAtOpen;
				const saveItems = needsRebuild
					? [
						{ value: "save-rebuild-exit", label: dirty ? "Save and rebuild" : "Build image and exit", description: imageMissingAtOpen ? `No sandbox image found for ${configuredImageName}` : "Persist changes and rebuild the sandbox image in the main Pi TUI" },
						{ value: "save-exit", label: dirty ? "Save without rebuilding" : "Exit without rebuilding", description: dirty ? "Persist changes; rebuild the sandbox image later" : "Leave configuration unchanged" },
						{ value: "discard-exit", label: dirty ? "Exit without saving" : "Back", description: dirty ? "Discard pending changes" : "Return to editor" },
					]
					: [
						{ value: "save-exit", label: "Save changes", description: "Apply pending config changes" },
						{ value: "discard-exit", label: "Exit without saving", description: "Discard pending changes" },
						{ value: "back", label: "Back", description: "Return to editor" },
					];
				const changeItems = needsRebuild ? [] : pendingActions.map((action, index) => ({ value: `change:${index}`, label: `Change ${index + 1}`, description: describeConfigAction(action, loadedCfg, cfg) }));
				return { title: "UNSAVED CHANGES", subtitle: `${pendingActions.length} pending change(s)`, items: [...saveItems, ...changeItems] };
			}
			if (key.startsWith("confirm-delete-change:")) {
				const index = Number(key.slice("confirm-delete-change:".length));
				const action = pendingActions[index];
				return { title: "ROLL BACK CHANGE", subtitle: action ? describeConfigAction(action, loadedCfg, cfg) : "Unknown change", items: [{ value: `delete-change:${index}`, label: "Delete this pending change", description: "Roll back this change and recompute dependent config state" }, { value: "back", label: "Back", description: "Return to unsaved changes" }] };
			}
			return mainScreen();
		};

		const beginTextAction = (type: BacklogConfigAction["type"], title: string, payload: Record<string, string> = {}, initial = "") => {
			textAction = type;
			textPayload = payload;
			textTitle = title;
			editBuffer = initial;
			editCursor = initial.length;
			editSelectAll = !!initial;
			tui.requestRender();
		};

		const applyActionToModel = (action: BacklogConfigAction) => {
			if (action.type === "set-config") model.setConfigValue(action.path, coerceConfigValue(action.path, action.value));
			if (action.type === "add-agent") model.addAgent(action.name);
			if (action.type === "rename-agent") model.renameAgent(action.oldName, action.newName);
			if (action.type === "delete-agent") model.deleteAgent(action.name);
			if (action.type === "add-pipeline") model.addPipeline(action.name);
			if (action.type === "rename-pipeline") model.renamePipeline(action.oldName, action.newName);
			if (action.type === "delete-pipeline") model.deletePipeline(action.name);
			if (action.type === "add-pipeline-step") model.addPipelineStep(action.pipeline);
			if (action.type === "delete-pipeline-step") model.deletePipelineStep(action.pipeline, action.index);
		};

		const rebuildModelFromPendingActions = () => {
			unsubscribeModel();
			model = new ConfigShadowModel(loadedCfg);
			cfg = model.value as SandcastleConfig;
			unsubscribeModel = model.onChange(() => { cfg = model.value as SandcastleConfig; });
			for (const action of pendingActions) applyActionToModel(action);
			cfg = model.value as SandcastleConfig;
			dirty = pendingActions.length > 0;
		};

		const removePendingAction = (index: number) => {
			if (index < 0 || index >= pendingActions.length) return;
			pendingActions.splice(index, 1);
			rebuildModelFromPendingActions();
			if (pendingActions.length === 0) route = ["main"];
			else route = ["main", "confirm-exit"];
			selected = 0;
			tui.requestRender();
		};

		const replaceDraftConfig = (nextConfig: SandcastleConfig) => {
			unsubscribeModel();
			model = new ConfigShadowModel(nextConfig);
			cfg = model.value as SandcastleConfig;
			unsubscribeModel = model.onChange(() => { cfg = model.value as SandcastleConfig; });
			pendingActions.splice(0, pendingActions.length, { type: "replace-config", config: cfg });
			dirty = true;
			route = ["main"];
			selected = 0;
			tui.requestRender();
		};

		const openDraftInEditor = () => {
			const tmpRoot = mkdtempSync(join(tmpdir(), "agent-workflows-config-"));
			const draftPath = join(tmpRoot, "config.yaml");
			writeFileSync(draftPath, configToYaml(cfg));
			tui.stop?.();
			process.stdout.write("\x1b[2J\x1b[H");
			const status = runTerminalEditor(ctx.cwd, draftPath);
			tui.start?.();
			try {
				if (status !== 0) throw new Error(`Editor exited with code ${status}.`);
				const parsed = mergeWithPackDefaults(normalizeConfig(parseSimpleYaml(readFileSync(draftPath, "utf8"))));
				replaceDraftConfig(parsed);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			} finally {
				rmSync(tmpRoot, { recursive: true, force: true });
				tui.requestRender(true);
			}
		};

		const choose = () => {
			const active = screen();
			const item = active.items[selected];
			if (!item) return;
			const value = String(item.value);
			if (value.startsWith("nav:")) return open(value.slice(4));
			if (value.startsWith("field:")) {
				editPath = value.slice("field:".length);
				editBuffer = pathValue(editPath);
				editChoices = selectableValuesForPath(cfg, editPath);
				editChoiceIndex = 0;
				editAllowCustom = allowsCustomValueForPath(editPath);
				editCustom = editChoices.length === 0;
				editCursor = editBuffer.length;
				editSelectAll = editCustom && !!editBuffer;
				tui.requestRender();
				return;
			}
			if (value.startsWith("text:add-agent")) return beginTextAction("add-agent", "NEW ROLE");
			if (value.startsWith("text:add-pipeline")) return beginTextAction("add-pipeline", "NEW PIPELINE");
			if (value.startsWith("text:import-config-file")) return beginTextAction("import-config-file", "IMPORT CONFIG FILE", {}, "./.pi/sandcastle/config.yaml");
			if (value.startsWith("text:rename-agent:")) return beginTextAction("rename-agent", "RENAME ROLE", { oldName: value.slice("text:rename-agent:".length) }, value.slice("text:rename-agent:".length));
			if (value.startsWith("text:rename-pipeline:")) return beginTextAction("rename-pipeline", "RENAME PIPELINE", { oldName: value.slice("text:rename-pipeline:".length) }, value.slice("text:rename-pipeline:".length));
			if (value.startsWith("delete-agent:")) { const name = value.slice("delete-agent:".length); model.deleteAgent(name); route = ["main", "agents"]; return queueAction({ type: "delete-agent", name }); }
			if (value.startsWith("delete-pipeline:")) { const name = value.slice("delete-pipeline:".length); model.deletePipeline(name); route = ["main", "pipelines"]; return queueAction({ type: "delete-pipeline", name }); }
			if (value.startsWith("add-pipeline-step:")) { const pipeline = value.slice("add-pipeline-step:".length); model.addPipelineStep(pipeline); return queueAction({ type: "add-pipeline-step", pipeline }); }
			if (value.startsWith("delete-pipeline-step:")) { const [, pipeline, indexText] = value.split(":"); const index = Number(indexText); model.deletePipelineStep(pipeline, index); route = ["main", "pipelines", `pipeline:${pipeline}`]; return queueAction({ type: "delete-pipeline-step", pipeline, index }); }
			if (value.startsWith("pack:")) { pendingPack = value.slice(5); return replace("confirm-pack"); }
			if (value.startsWith("editor:")) { setPreferredEditor(ctx.cwd, value.slice(7)); route = ["main", "actions"]; selected = 0; ctx.ui.notify(`Preferred Agent Workflows config editor set to: ${value.slice(7)}`, "success"); return tui.requestRender(); }
			if (value === "action:init") { replaceDraftConfig(DEFAULT_CONFIG); return; }
			if (value === "action:edit") return openDraftInEditor();
			if (value === "action:validate") return done({ type: "validate" });
			if (value === "action:build") return done({ type: "build-image" });
			if (value === "action:apply-pack") { replaceDraftConfig(mergeWithPackDefaults(normalizeConfig(parseSimpleYaml(configPackText(pendingPack))))); return; }
			if (value === "save-rebuild-exit") return done({ type: "batch", actions: pendingActions, config: cfg, rebuildImage: true });
			if (value === "save-exit") return dirty ? done({ type: "batch", actions: pendingActions, config: cfg }) : done({ type: "cancel" });
			if (value === "discard-exit") return (!dirty && imageMissingAtOpen) ? back() : done({ type: "cancel" });
			if (value.startsWith("change:")) return open(`confirm-delete-change:${value.slice("change:".length)}`);
			if (value.startsWith("delete-change:")) return removePendingAction(Number(value.slice("delete-change:".length)));
			if (value === "back") return back();
			if (value === "cancel") return (dirty || imageMissingAtOpen) ? open("confirm-exit") : done({ type: "cancel" });
		};

		const back = () => {
			if (editPath || textAction) { editPath = null; textAction = null; editBuffer = ""; editChoices = []; editCustom = false; editAllowCustom = true; editCursor = 0; editSelectAll = false; tui.requestRender(); return; }
			if (current() === "confirm-exit" || current().startsWith("confirm-delete-change:")) { route = route.slice(0, -1); selected = 0; tui.requestRender(); return; }
			if (route.length <= 1) dirty ? open("confirm-exit") : done({ type: "cancel" });
			else { route = route.slice(0, -1); selected = 0; tui.requestRender(); }
		};

		const setLocalConfigValue = (path: string, value: string) => {
			model.setConfigValue(path, coerceConfigValue(path, value));
		};

		const queueAction = (action: BacklogConfigAction) => {
			pendingActions.push(action);
			dirty = model.isDirty() || pendingActions.length > 0;
			editPath = null; textAction = null; editBuffer = ""; editChoices = []; editCustom = false; editCursor = 0; editSelectAll = false;
			tui.requestRender();
		};

		const submitEdit = () => {
			if (textAction) {
				const name = editBuffer.trim();
				if (!name) return;
				if (textAction === "add-agent") { model.addAgent(name); return queueAction({ type: "add-agent", name }); }
				if (textAction === "add-pipeline") { model.addPipeline(name); return queueAction({ type: "add-pipeline", name }); }
				if (textAction === "import-config-file") {
					const filePath = name.startsWith("/") ? resolve(name) : resolve(ctx.cwd, name);
					try {
						const imported = mergeWithPackDefaults(normalizeConfig(parseSimpleYaml(readFileSync(filePath, "utf8"))));
						replaceDraftConfig(imported);
					} catch (error) {
						ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
					}
					textAction = null; editBuffer = "";
					return;
				}
				if (textAction === "rename-agent") {
					model.renameAgent(textPayload.oldName, name);
					route = ["main", "agents"];
					return queueAction({ type: "rename-agent", oldName: textPayload.oldName, newName: name });
				}
				if (textAction === "rename-pipeline") { model.renamePipeline(textPayload.oldName, name); route = ["main", "pipelines"]; return queueAction({ type: "rename-pipeline", oldName: textPayload.oldName, newName: name }); }
			}
			if (!editPath) return;
			const value = editCustom || !editChoices.length ? editBuffer : editChoices[editChoiceIndex];
			setLocalConfigValue(editPath, value);
			queueAction({ type: "set-config", path: editPath, value });
		};

		const line = (text: string, width: number) => text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
		const selectTheme = (theme?: any): PiSelectListTheme => ({
			selectedPrefix: (text: string) => theme?.fg ? theme.fg("accent", text) : text,
			selectedText: (text: string) => theme?.fg ? theme.fg("accent", text) : text,
			description: (text: string) => theme?.fg ? theme.fg("muted", text) : text,
			scrollInfo: (text: string) => theme?.fg ? theme.fg("dim", text) : text,
			noMatch: (text: string) => theme?.fg ? theme.fg("muted", text) : text,
		});
		const buildSelectList = (active: Screen, theme?: any) => {
			const list = new PiSelectList(active.items.map((item) => ({ value: String(item.value), label: item.label, description: item.description })), 14, selectTheme(theme));
			list.setSelectedIndex(selected);
			list.onSelectionChange = (item) => { selected = Math.max(0, active.items.findIndex((candidate) => String(candidate.value) === item.value)); };
			list.onSelect = () => choose();
			list.onCancel = () => back();
			return list;
		};
		return {
			render: (width: number) => {
				const border = theme.fg("accent", "═".repeat(Math.max(1, width)));
				if (editPath || textAction) {
					const title = textAction ? textTitle : `EDIT ${friendlyConfigLabel(editPath || "")}`;
					const rendered = [border, theme.fg("accent", theme.bold(` ${title}`)), theme.fg("dim", "Enter saves • Esc cancels • Backspace edits"), ""];
					if (editPath && editChoices.length && !editCustom) {
						const renderedChoices = editAllowCustom ? [...editChoices, "custom…"] : editChoices;
						for (const [index, choice] of renderedChoices.entries()) {
							const label = choice === "default" && editPath ? `Inherited: ${effectiveDefaultForPath(cfg, editPath) || "Not set"}` : choice;
							rendered.push(`${index === editChoiceIndex ? theme.fg("accent", "▶ ") : "  "}${index === editChoiceIndex ? theme.fg("accent", label) : label}`);
						}
					} else {
						const visible = editBuffer ? (editSelectAll ? `[${editBuffer}]` : `${editBuffer.slice(0, editCursor)}▌${editBuffer.slice(editCursor)}`) : theme.fg("muted", "<empty>");
						rendered.push(line(visible, width));
					}
					rendered.push("", border);
					return rendered.map((entry) => line(entry, width));
				}
				const active = screen();
				selected = Math.min(selected, Math.max(0, active.items.length - 1));
				const rendered = [border, theme.fg("accent", theme.bold(` ${active.title}`)), theme.fg("dim", active.subtitle || ""), theme.fg("dim", ` path: ${route.join(" > ")}`), ""];
				rendered.push(...buildSelectList(active, theme).render(width));
				rendered.push("", theme.fg("dim", " ↑↓ navigate • enter select/edit • esc back/close • ctrl+q force quit"), border);
				return rendered.map((entry) => line(entry, width));
			},
			invalidate: () => {},
			handleInput: (data: string) => {
				if (isTuiForceQuit(data)) { done({ type: "cancel" }); return; }
				if (editPath || textAction) {
					if (isTuiEscape(data)) back();
					else if (editPath && editChoices.length && !editCustom && data === "\x1b[A") editChoiceIndex = Math.max(0, editChoiceIndex - 1);
					else if (editPath && editChoices.length && !editCustom && data === "\x1b[B") editChoiceIndex = Math.min(editChoices.length - (editAllowCustom ? 0 : 1), editChoiceIndex + 1);
					else if (data === "\r" || data === "\n") {
						if (editPath && editAllowCustom && editChoices.length && !editCustom && editChoiceIndex === editChoices.length) { editCustom = true; editBuffer = ""; }
						else submitEdit();
					}
					else if (!editChoices.length || editCustom || textAction) {
						if (data === "\x1b[D") { editSelectAll = false; editCursor = Math.max(0, editCursor - 1); }
						else if (data === "\x1b[C") { editSelectAll = false; editCursor = Math.min(editBuffer.length, editCursor + 1); }
						else if (data === "\x7f" || data === "\b") {
							if (editSelectAll) { editBuffer = ""; editCursor = 0; editSelectAll = false; }
							else if (editCursor > 0) {
								editBuffer = `${editBuffer.slice(0, editCursor - 1)}${editBuffer.slice(editCursor)}`;
								editCursor--;
							}
						}
						else if (data >= " " && data !== "\x7f") {
							if (editSelectAll) { editBuffer = ""; editCursor = 0; editSelectAll = false; }
							editBuffer = `${editBuffer.slice(0, editCursor)}${data}${editBuffer.slice(editCursor)}`;
							editCursor += data.length;
						}
					}
					tui.requestRender();
					return;
				}
				const active = screen();
				buildSelectList(active).handleInput(data);
				tui.requestRender();
			},
		};
	}, { overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", minWidth: 60, anchor: "center", margin: 1 } });
}

export default function agentWorkflows(
	pi: ExtensionAPI,
	deps: PiSandcastleDependencies = {},
) {
	const runs = new Map<string, RunState>();
	let widgetCtx: { ui: { setWidget: (id: string, lines: string[] | undefined) => void; notify: (message: string, type?: string) => void } } | undefined;
	let configImageRebuild: Promise<void> | undefined;
	const sandcastle = deps.sandcastle ?? createDefaultSandcastleRunCapability();
	const backlogDeps = deps.work || deps.backlog || {};
	let widgetRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	const isConfigImageRebuildInProgress = () => !!configImageRebuild;
	const startConfigImageRebuild = (ctx: any, cfg: SandcastleConfig) => {
		const provider = imageProviderForSandbox(cfg.defaultSandbox) || "docker";
		const imageName = defaultSandcastleImageName(ctx.cwd, cfg.imageNamePattern);
		if (configImageRebuild) return configImageRebuild;
		ctx.ui.notify(`Rebuilding Sandcastle ${provider} image ${imageName}. Commands using the sandbox should be retried after this completes.`, "info");
		configImageRebuild = (async () => {
			await ensureScaffoldForImageBuild(ctx.cwd, cfg, provider, (message, type) => ctx.ui.notify(message, type));
			await buildSandboxImageOnce(ctx.cwd, provider, imageName, deps.image?.buildImage || buildSandboxImage);
		})().then(() => {
			ctx.ui.notify(`Rebuilt Sandcastle ${provider} image ${imageName}. Retry any command that was waiting for the rebuild.`, "success");
		}).catch((error) => {
			ctx.ui.notify(`Sandcastle image rebuild failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		}).finally(() => { configImageRebuild = undefined; });
		return configImageRebuild;
	};

	function refreshWidget() {
		widgetCtx?.ui.setWidget("agent-workflows", renderWidget(runs));
		if ([...runs.values()].some((run) => run.status === "running") && !widgetRefreshTimer) {
			widgetRefreshTimer = setTimeout(() => {
				widgetRefreshTimer = undefined;
				refreshWidget();
			}, 1000);
			widgetRefreshTimer.unref?.();
		}
	}

	function helpText(): string {
		return `Agent Workflows commands

Setup and configuration:
  /work:config
    Open the friendly graph-aware config TUI.

  /work:config-raw show|init|edit|editor|get|set|reset|validate
    Run raw config utility actions for graph-native or legacy configs.

Execution utilities:
  /work:build-image [docker|podman]
    Build the repo execution sandbox image.

  /work:run [role] <prompt>
    Run one configured Role directly.

  /work:pipeline <pipeline> [prompt]
    Run a graph-native runtime Pipeline directly, with legacy steps[] fallback.

Work views and processing:
  /work:list [query]
    List Work Items without mutation.

  /work:inspect <item-id>
    Inspect one Work Item without mutation.

  /work:plan [query] --iterations N
    Plan read-only Work iterations.

  /work:next [query]
    Plan the next Work iteration.

  /work:process [query] --pipeline <pipeline>
    Start durable Work processing through graph lanes, per-lane worktrees, and the runtime adapter.

  /work:runs|status|resume
    Manage durable Work Process runs.`;
	}

	function getBacklogResumeCapability(ctx: any): ((record: unknown) => Promise<unknown> | unknown) | undefined {
		return ctx?.backlogResume
			?? ctx?.capabilities?.backlog?.resume
			?? ctx?.capabilities?.sandcastle?.resume
			?? ctx?.sandcastle?.resume
			?? ctx?.resume;
	}

	registerScRunCommand(pi, sandcastle, { ...deps, isConfigImageRebuildInProgress });

	function formatAuthoritativePlan(plan: any): string {
		if (typeof plan === "string") return plan;
		if (plan?.summary) return [plan.summary, ...(Array.isArray(plan.iterations) ? plan.iterations.map((iteration: any, index: number) => `Iteration ${index + 1}: ${(iteration.items || []).length} item(s)`) : [])].join("\n");
		return JSON.stringify(plan, null, 2);
	}


	async function runPlannerPhase(args: string, ctx: any): Promise<any> {
		const cfg = await loadConfig(ctx.cwd);
		const agent = selectPlanWorkRoleName(cfg);
		const readyOutput = backlogDeps.ready
			? await backlogDeps.ready(ctx.cwd, args)
			: (await runProcess(ctx.cwd, "dv", ["work", "ready"])).stdout.trim();
		const task = `Run the Work planning phase for this repository.\n\nGuardrails: you are running inside an isolated planner workspace created through the normal execution engine. Do not attempt to update the source repository, create branches for execution, or perform Work Source mutations. Any filesystem changes you make are discarded after planning.\n\nRequested plan arguments: ${args || "(none)"}\n\nMax workers available for a single parallel iteration: ${cfg.maxWorkers || 5}. When selecting unblocked-ready-AFK work, plan no more than this many independently executable items in one actionable iteration.\n\nReady Work input from the configured Work Source:\n${readyOutput}\n\nReturn one authoritative Work Plan JSON object using kind \"workPlan\" and scope \"forecast\". Include an actionable Work Plan at field actionable with scope \"actionable\" containing only currently executable work from the Ready Work input. The top-level forecast iterations may map future waves that could become unblocked after earlier iterations complete, but forecast waves are advisory only. Each iteration must contain an items array of objects such as {\"id\": \"wi-001\"}; do not return bare string item ids. Each iteration rationale must be a string; if you have dependency/classification/risk rationale, combine it into one readable rationale string or put details in classifications. Include any HITL constraints and blocked/deferred work summaries when relevant. Do not author execution mechanics such as pipeline names or branch names. End with <promise>COMPLETE</promise>.`;
		if (backlogDeps.runPlanWorkRole) return backlogDeps.runPlanWorkRole({ cwd: ctx.cwd, args, role: agent, task, ctx });
		const run = await dispatch(ctx.cwd, agent, task, ctx, { branchPrefix: "agent-workflows/planner" });
		await new Promise<void>((resolve) => run.proc?.on("close", () => resolve()));
		if (run.status !== "done") throw new Error(`Planner role failed: ${run.lastLine}`);
		return JSON.parse(readFileSync(run.resultPath!, "utf8"));
	}

	async function notifyBacklogPlan(args: string, ctx: any, overrides?: { iterations?: number }): Promise<void> {
		try {
			const effectiveArgs = overrides?.iterations && !/--iterations(?:=|\s|$)/.test(args) ? `${args} --iterations=${overrides.iterations}`.trim() : args;
			const plan = await runPlannerPhase(effectiveArgs, ctx);
			const createdAt = getBacklogTimestamp(backlogDeps.now);
			const validationErrors = validateExecutablePlanArtifact(plan);
			if (validationErrors.length) {
				const invalidRecord = { id: createInvalidBacklogPlanId(createdAt), kind: "invalid-work-plan", createdAt, args: effectiveArgs, rawOutput: plan, validationErrors };
				const invalidRecordPath = writeBacklogPlanRecord(ctx.cwd, invalidRecord);
				ctx.ui.notify(`Planner output is not executable:\n- ${validationErrors.join("\n- ")}\n\nCached invalid output: ${invalidRecord.id}\nRecord: ${invalidRecordPath}`, "error");
				return;
			}
			const normalizedPlan = normalizeWorkPlanArtifact(plan);
			const record = { id: createBacklogPlanId(createdAt), kind: "work-plan", createdAt, args: effectiveArgs, plan: normalizedPlan };
			const recordPath = writeBacklogPlanRecord(ctx.cwd, record);
			ctx.ui.notify(`${formatAuthoritativePlan(normalizedPlan)}\n\nCached plan: ${record.id}\nRecord: ${recordPath}`, "info");
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	}

	async function notifyBacklogReady(args: string, ctx: any): Promise<void> {
		try {
			const output = backlogDeps.ready
				? await backlogDeps.ready(ctx.cwd, args)
				: (await runProcess(ctx.cwd, "dv", ["work", "ready", ...tokenizeCommandArgs(args)])).stdout.trim();
			ctx.ui.notify(output || "No ready work candidates.", "info");
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	}

	async function dispatch(cwd: string, agentName: string, task: string, ctx?: any, options: { branchPrefix?: string } = {}): Promise<RunState> {
		assertSandcastleWorkspaceSource(cwd);
		ensureScaffold(cwd, { hydrate: false });
		const cfg = await loadConfig(cwd);
		const agent = cfg.agents[agentName];
		if (!agent) throw new Error(`Unknown execution agent '${agentName}'. Run /work:config show to inspect configured agents.`);
		const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}-${agentName}`;
		const resultPath = join(cwd, RESULTS_DIR, `${id}.json`);
		const logPath = join(cwd, RESULTS_DIR, `${id}.log`);
		const branch = agent.branch || `${options.branchPrefix || "sandcastle"}/${agentName}/${id}`;
		const jobPath = join(cwd, JOBS_DIR, `${id}.json`);
		const runtime = resolveAgentRuntimeSettings(agent, cfg);
		const hostPiRuntime = runtime.provider === "pi" ? createHostPiAgentRuntime() : undefined;
		const job = {
			id,
			name: `${agentName}:${id}`,
			agent: agentName,
			cwd,
			model: runtime.model,
			provider: runtime.provider,
			sandbox: runtime.sandbox,
			imageName: defaultSandcastleImageName(cwd, cfg.imageNamePattern),
			hostPiConfig: runtime.provider === "pi",
			hostPiAgentDir: hostPiRuntime?.dir,
			hostPiFileMounts: hostPiRuntime?.fileMounts,
			systemPrompt: agent.systemPrompt || "",
			prompt: task,
			maxIterations: agent.maxIterations || cfg.maxIterations || 10,
			outputKind: agent.kind === "planWork" ? "work-plan" : undefined,
			branch,
			copyToWorktree: agent.copyToWorktree,
			logPath,
			resultPath,
		};
		writeFileSync(jobPath, JSON.stringify(job, null, 2));

		const state: RunState = { id, agent: agentName, task, status: "running", startedAt: Date.now(), lastLine: "starting", logPath, resultPath, branch };
		runs.set(id, state);
		refreshWidget();

		try {
			await ensureSandboxImage(cwd, runtime.sandbox, deps.image, (reason, imageName) => {
				state.lastLine = `building ${reason} image ${imageName}`;
				ctx?.ui?.notify(`Execution image ${imageName} is ${reason}; rebuilding before dispatch.`, "info");
				refreshWidget();
			}, cfg);
		} catch (error) {
			if (hostPiRuntime?.dir) rmSync(hostPiRuntime.dir, { recursive: true, force: true });
			state.status = "error";
			state.lastLine = error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120);
			refreshWidget();
			ctx?.ui?.notify(`Sandcastle ${agentName} error: ${id}`, "error");
			return state;
		}

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
			const run = await dispatch(cwd, step.role, prompt, ctx);
			await new Promise<void>((resolve) => run.proc?.on("close", () => resolve()));
			if (run.status !== "done") break;
			input = `Run ${run.id} completed. Branch: ${run.branch}. Commits: ${(run.commits || []).join(", ") || "none"}. Log: ${run.logPath}. Result: ${run.resultPath}.`;
		}
	}

	async function delegateDefault(cwd: string, task: string, ctx?: any): Promise<void> {
		const cfg = await loadConfig(cwd);
		const agent = cfg.agents.planner ? "planner" : Object.keys(cfg.agents)[0];
		if (!agent) throw new Error("No execution agents configured. Run /work:config init, then edit .pi/sandcastle/config.yaml.");
		await dispatch(cwd, agent, task, ctx);
	}

	async function delegateOpenWork(cwd: string, focus: string, ctx?: any): Promise<void> {
		const task = `Inspect available open work for this repository and recommend what to pick up next.\n\nLook for, in order when available:\n1. GitHub issues and PRs via gh (for example: gh issue list, gh pr list).\n2. Local backlog/work-item directories, docs, TODO/FIXME comments, and project planning files.\n3. Failing or skipped tests that indicate unfinished work.\n\nFocus: ${focus || "general project work"}\n\nOutput:\n- Ranked open work items with source/link/file evidence.\n- Suggested first item to delegate next.\n- A ready-to-run /work:run command for the top item.\n\nDo not modify files. End with <promise>COMPLETE</promise>.`;
		const cfg = await loadConfig(cwd);
		const agent = cfg.agents.planner ? "planner" : Object.keys(cfg.agents)[0];
		if (!agent) throw new Error("No execution agents configured. Run /work:config init, then edit .pi/sandcastle/config.yaml.");
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
		if (!cfg.pipelines[pipeline]) {
			const available = Object.keys(cfg.pipelines).sort();
			throw new Error(`No configured Work pipeline '${pipeline}'. Run /work:config init to hydrate default pipelines or choose one of: ${available.length ? available.join(", ") : "(none configured)"}.`);
		}
		switch (pipeline) {
			case "review":
				return selectConfiguredAgent(cfg, ["reviewer", "implementer"], "implementer");
			case "research":
			case "inspect":
				return selectConfiguredAgent(cfg, ["planner"], "planner");
			case "archive":
				return selectConfiguredAgent(cfg, ["reviewer", "implementer"], "reviewer");
			case "fix":
			case "repair":
			case "implement":
			case "explore-plan-review":
			default:
				return selectConfiguredAgent(cfg, ["implementer", "worker"], "implementer");
		}
	}

	async function dispatchBacklogItem(
		cwd: string,
		agentName: string,
		record: BacklogProcessRecord,
		item: BacklogItem,
		ctx?: any,
	): Promise<BacklogItemDispatchResult> {
		const workBrief = renderWorkBrief(item);
		const prompt = `${workBrief}\n\n## Execution\n\nPipeline: ${record.pipeline}\nQuery: ${record.query}\n\nDo not modify unrelated work. End with <promise>COMPLETE</promise>.`;
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

	async function dispatchBacklogItemsWithLimit(
		cwd: string,
		agentName: string,
		record: BacklogProcessRecord,
		limit: number,
		ctx?: any,
	): Promise<BacklogItemDispatchResult[]> {
		const results = new Array<BacklogItemDispatchResult>(record.resolvedItems.length);
		let next = 0;
		const workers = Array.from({ length: Math.min(limit, record.resolvedItems.length) }, async () => {
			while (next < record.resolvedItems.length) {
				const index = next++;
				results[index] = await dispatchBacklogItem(cwd, agentName, record, record.resolvedItems[index], ctx);
			}
		});
		await Promise.all(workers);
		return results;
	}

	function pruneTerminalWidgetRows(): void {
		let changed = false;
		for (const [id, run] of runs.entries()) {
			if (run.status === "done" || run.status === "error" || run.status === "cancelled") {
				runs.delete(id);
				changed = true;
			}
		}
		if (changed) refreshWidget();
	}

	async function executeBacklogProcessing(
		cwd: string,
		input: {
			runId: string;
			query: string;
			pipeline: string;
			items: WorkItem[];
			parallel: boolean;
			executionContexts: WorkExecutionContext[];
			executionGroups: WorkExecutionGroup[];
			recordPath: string;
		},
		ctx?: any,
	): Promise<BacklogExecutionResult> {
		if (backlogDeps.execute) return backlogDeps.execute(cwd, input);

		pruneTerminalWidgetRows();
		const contextByItemId = new Map(input.executionContexts.map((context) => [context.itemId, context]));
		const runtimePrompt = [
			`Work process ${input.runId}`,
			`Pipeline: ${input.pipeline}`,
			`Query: ${input.query || "(none)"}`,
			`Parallel requested: ${input.parallel ? "yes" : "no"}`,
			"",
			"Execution contexts (orchestrator-owned; do not rename branches):",
			...input.executionContexts.map((context) => `- ${context.itemId}: context ${context.contextId}, branch ${context.branch}`),
			"",
			"Items:",
			...input.items.map((item) => {
				const context = contextByItemId.get(item.id);
				return `- ${item.id} ${item.title} (${item.sourcePath})${item.summary ? ` — ${item.summary}` : ""}${context ? ` [context ${context.contextId}]` : ""}`;
			}),
		].join("\n");
		const statusRows = new Map<number, RunState[]>();
		const cfg = await loadConfig(cwd);
		const processPipeline = cfg.pipelines[input.pipeline];
		const useGraphStatusRows = Boolean(processPipeline && pipelineHasGraphNodes(processPipeline));
		if (!useGraphStatusRows) {
			for (const [index, step] of (processPipeline?.steps || []).entries()) {
				const parallelSlots = input.parallel && step.role === "implementer" ? Math.max(1, Number(cfg.maxWorkers || 5)) : 1;
				const rows = Array.from({ length: parallelSlots }, (_, fanoutIndex) => {
					const item = input.parallel && step.role === "implementer" ? input.items[fanoutIndex] : undefined;
					const suffix = item ? `-${sanitizePathSegment(item.id)}` : parallelSlots > 1 ? `-slot-${fanoutIndex + 1}` : "";
					const row: RunState = {
						id: `${input.runId}-worker-${index + 1}${suffix}`,
						agent: step.role,
						task: `Work process ${input.runId} · pipeline ${input.pipeline} · worker ${index + 1}`,
						status: "queued",
						startedAt: Date.now(),
						lastLine: item ? `waiting for ${item.id}` : parallelSlots > 1 ? `waiting for parallel slot ${fanoutIndex + 1}` : `waiting for step ${index + 1}`,
					};
					runs.set(row.id, row);
					return row;
				});
				statusRows.set(index, rows);
			}
		}
		if (statusRows.size) refreshWidget();
		const updateWorkerStatus = (step: PipelineRunStepRecord) => {
			let rows = statusRows.get(step.index);
			if (!rows?.length) {
				const row: RunState = {
					id: `${input.runId}-worker-${step.index + 1}`,
					agent: step.role,
					task: `Work process ${input.runId} · pipeline ${input.pipeline} · worker ${step.index + 1}`,
					status: "queued",
					startedAt: Date.now(),
					lastLine: `waiting for step ${step.index + 1}`,
				};
				rows = [row];
				statusRows.set(step.index, rows);
				runs.set(row.id, row);
			}
			for (const row of rows) {
				const nextStatus = step.status === "completed" ? "done" : step.status === "failed" ? "error" : "running";
				const terminal = row.status === "done" || row.status === "error" || row.status === "cancelled";
				if (terminal && nextStatus === "running") continue;
				row.agent = step.role;
				row.status = nextStatus;
				if ((nextStatus === "done" || nextStatus === "error") && row.endedAt === undefined) row.endedAt = Date.now();
				if (nextStatus === "running") row.endedAt = undefined;
				row.branch = step.branch;
				row.commits = step.commits;
				row.logPath = step.logPath;
				row.kind = step.kind;
				row.nodePath = step.nodePath;
				row.laneId = step.laneId;
				row.itemId = step.itemId;
				if (step.status === "running" && row.lastLine.startsWith("waiting")) row.lastLine = `iter 0${step.maxIterations ? `/${step.maxIterations}` : ""}: started ${step.nodePath || `step ${step.index + 1}`}`;
				if (step.status === "completed" || step.status === "failed") row.lastLine = `${step.status}${step.branch ? ` on ${step.branch}` : ""}`;
			}
			refreshWidget();
		};
		try {
			const pipelineRun = await executePipeline(cwd, input.pipeline, runtimePrompt, {
				...deps.pipeline,
				graphInput: {
					prompt: runtimePrompt,
					query: input.query,
					items: input.items,
					executionContexts: input.executionContexts,
					executionGroups: input.executionGroups,
				},
				image: deps.pipeline?.image || deps.image,
				onStepUpdate: (step, record) => {
					updateWorkerStatus(step);
					deps.pipeline?.onStepUpdate?.(step, record);
				},
				onStepStreamEvent: (step, event, record) => {
					updateWorkerStatus(step);
					const rows = statusRows.get(step.index) || [];
					const status = formatAgentStreamStatus(event, step.maxIterations);
					if (status) {
						for (const row of rows) if (row.status === "running") row.lastLine = status;
						refreshWidget();
					}
					deps.pipeline?.onStepStreamEvent?.(step, event, record);
				},
			});
			if (pipelineRun.executor === "graph") {
				const nodeBranches = Array.from(new Set((pipelineRun.nodes || []).map((node) => node.branch).filter((branch): branch is string => !!branch)));
				const nodeLogs = Array.from(new Set([
					...pipelineRun.steps.map((step) => step.logPath),
					...(pipelineRun.nodes || []).map((node) => node.logPath),
				].filter((logPath): logPath is string => !!logPath)));
				return {
					branches: nodeBranches,
					logs: nodeLogs,
					workerStatuses: (pipelineRun.nodes || []).map((node, index) => ({
						index,
						role: node.role || node.kind,
						status: node.status,
						branch: node.branch,
						commits: node.commits || [],
						logPath: node.logPath,
						error: undefined,
						nodePath: node.nodePath,
						kind: node.kind,
						laneId: node.laneId,
						itemId: node.itemId,
					})),
					status: pipelineRun.status === "completed" ? "done" : "error",
				};
			}
			return {
				branches: [pipelineRun.branch].filter((branch): branch is string => !!branch),
				logs: pipelineRun.steps.map((step) => step.logPath).filter((logPath): logPath is string => !!logPath),
				workerStatuses: pipelineRun.steps.map((step) => ({ index: step.index, role: step.role, status: step.status, branch: step.branch, commits: step.commits, logPath: step.logPath, error: step.error })),
				status: pipelineRun.status === "completed" ? "done" : "error",
			};
		} catch (error) {
			for (const rows of statusRows.values()) {
				for (const row of rows) {
					if (row.status === "running") {
						row.status = "error";
						row.endedAt = Date.now();
						row.lastLine = error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120);
					}
				}
			}
			if (statusRows.size) refreshWidget();
			throw error;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		widgetCtx = ctx as any;
		try {
			await loadConfig(ctx.cwd);
			refreshWidget();
		} catch (error) {
			ctx.ui.notify(`agent-workflows config error: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		try {
			const cfg = await loadConfig(ctx.cwd);
			const agentLines = Object.entries(cfg.agents).map(([name, agent]) => `- ${name}: ${agent?.description || "configured delegation agent"}`).join("\n");
			if (!agentLines) return;
			return {
				systemPrompt: `${event.systemPrompt}\n\n## Agent Workflows delegation mode\nAvailable agents:\n${agentLines}\n\nPrefer delegate_agent for delegable research, implementation, review, and AFK work. Dispatch prompts must be self-contained and include expected output/artifacts. Use /work:list and /work:inspect to inspect work, /work:run to start agent work, and /work:runs to inspect progress.`,
			};
		} catch {
			return;
		}
	});

	pi.on("session_shutdown", () => {
		for (const run of runs.values()) if (run.status === "running") run.proc?.kill("SIGTERM");
	});


	pi.registerCommand("work:build-image", {
		description: "Build the repo's execution sandbox image: /work:build-image [docker|podman]",
		getArgumentCompletions: (prefix: string) => completionItems(["docker", "podman"], tokenAfterLastSpace(prefix)),
		handler: async (args, ctx) => {
			if (isConfigImageRebuildInProgress()) {
				ctx.ui.notify("A sandbox image rebuild is already running. Retry /work:build-image after it completes.", "warning");
				return;
			}
			const providerArg = args.trim().split(/\s+/).filter(Boolean)[0] as "docker" | "podman" | undefined;
			const cfg = await loadConfig(ctx.cwd).catch(() => ({ defaultSandbox: DEFAULT_SANDBOX, prompts: {}, agents: {}, chains: {}, pipelines: {} }) as SandcastleConfig);
			const provider = providerArg || imageProviderForSandbox(cfg.defaultSandbox) || "docker";
			if (provider !== "docker" && provider !== "podman") {
				ctx.ui.notify("Usage: /work:build-image [docker|podman]", "error");
				return;
			}
			const imageName = defaultSandcastleImageName(ctx.cwd, cfg.imageNamePattern);
			try {
				ensureScaffold(ctx.cwd, { hydrate: true });
				await ensureScaffoldForImageBuild(ctx.cwd, cfg, provider, (message, type) => ctx.ui.notify(message, type));
				ctx.ui.notify(`Building Sandcastle ${provider} image ${imageName}...`, "info");
				await buildSandboxImageOnce(ctx.cwd, provider, imageName, deps.image?.buildImage || buildSandboxImage);
				ctx.ui.notify(`Built Sandcastle ${provider} image ${imageName}.`, "success");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("work:config", {
		description: "Open the friendly Agent Workflows configuration BIOS",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui" || !ctx.ui?.custom) {
				ctx.ui.notify("/work:config requires TUI mode. Use /work:config-raw for terminal commands.", "error");
				return;
			}
			const action = await showBacklogConfigTui(ctx);
			if (!action || action.type === "cancel") return;
			try {
				if (action.type === "batch" && action.config) {
					ensureScaffold(ctx.cwd, { hydrate: true });
					writeFileSync(join(ctx.cwd, CONFIG_PATH), configToYaml(action.config));
					ctx.ui.notify(`Saved ${action.actions.length} Agent Workflows config change(s).${action.rebuildImage ? " Starting sandbox image rebuild." : " Rebuild the sandbox image separately when needed."}`, "success");
					if (action.rebuildImage) startConfigImageRebuild(ctx, action.config);
					return;
				}
				const actions = action.type === "batch" ? action.actions : [action];
				for (const action of actions) {
					if (action.type === "init") {
						const result = ensureScaffold(ctx.cwd, { overwrite: true, hydrate: false });
						ctx.ui.notify(`Reset Agent Workflows config: ${result.changes.length ? result.changes.join("; ") : "no changes needed"}. Rebuild the sandbox image separately when needed.`, "success");
					}
					if (action.type === "apply-pack") {
						ensureScaffold(ctx.cwd, { hydrate: false });
						writeFileSync(join(ctx.cwd, CONFIG_PATH), configPackText(action.pack));
						ctx.ui.notify(`Imported config pack '${action.pack}' to ${CONFIG_PATH}. Rebuild the sandbox image separately when needed.`, "success");
					}
					if (action.type === "set-editor") {
						setPreferredEditor(ctx.cwd, action.editor);
						ctx.ui.notify(`Preferred Agent Workflows config editor set to: ${action.editor}`, "success");
					}
					if (action.type === "set-config") {
						if (!supportedConfigPath(action.path)) throw new Error(`Unsupported config path '${action.path}'.`);
						ensureScaffold(ctx.cwd, { hydrate: true });
						const configPath = join(ctx.cwd, CONFIG_PATH);
						const raw = readFileSync(configPath, "utf8");
						const updated = action.value === "default" && isDefaultableConfigPath(action.path)
							? removeConfigValueInText(raw, action.path)
							: setConfigValueInText(raw, action.path, coerceConfigValue(action.path, action.value));
						writeFileSync(configPath, updated);
						ctx.ui.notify(`Updated ${action.path}. Rebuild the sandbox image separately when needed.`, "success");
					}
					if (["add-agent", "rename-agent", "delete-agent", "add-pipeline", "rename-pipeline", "delete-pipeline"].includes(action.type)) {
						ensureScaffold(ctx.cwd, { hydrate: true });
						const configPath = join(ctx.cwd, CONFIG_PATH);
						const raw = readFileSync(configPath, "utf8");
						let updated = raw;
						if (action.type === "add-agent") updated = appendAgentText(raw, action.name);
						if (action.type === "rename-agent") updated = updateYamlReferences(renameTopLevelMapEntry(raw, roleSectionName(raw), action.oldName, action.newName), action.oldName, action.newName);
						if (action.type === "delete-agent") updated = removeYamlReferences(deleteTopLevelMapEntry(raw, roleSectionName(raw), action.name), action.name);
						if (action.type === "add-pipeline") updated = appendPipelineText(raw, action.name);
						if (action.type === "rename-pipeline") updated = renameTopLevelMapEntry(raw, "pipelines", action.oldName, action.newName);
						if (action.type === "delete-pipeline") updated = deleteTopLevelMapEntry(raw, "pipelines", action.name);
						writeFileSync(configPath, updated);
						ctx.ui.notify(`Updated ${CONFIG_PATH}. Rebuild the sandbox image separately when needed.`, "success");
					}
					if (action.type === "replace-config") {
						ensureScaffold(ctx.cwd, { hydrate: true });
						writeFileSync(join(ctx.cwd, CONFIG_PATH), configToYaml(action.config));
						ctx.ui.notify(`Replaced ${CONFIG_PATH}. Rebuild the sandbox image separately when needed.`, "success");
					}
					if (action.type === "validate") {
						const cfg = await loadExistingConfig(ctx.cwd);
						const issues = validateConfig(ctx.cwd, cfg);
						ctx.ui.notify(issues.length ? `Agent Workflows config validation failed:\n- ${issues.join("\n- ")}` : "Agent Workflows config validation passed.", issues.length ? "error" : "success");
					}
					if (action.type === "build-image") {
						const cfg = await loadConfig(ctx.cwd).catch(() => ({ defaultSandbox: DEFAULT_SANDBOX, prompts: {}, agents: {}, chains: {}, pipelines: {} }) as SandcastleConfig);
						const provider = imageProviderForSandbox(cfg.defaultSandbox) || "docker";
						const imageName = defaultSandcastleImageName(ctx.cwd, cfg.imageNamePattern);
						await ensureScaffoldForImageBuild(ctx.cwd, cfg, provider, (message, type) => ctx.ui.notify(message, type));
						ctx.ui.notify(`Building Sandcastle ${provider} image ${imageName}...`, "info");
						await buildSandboxImageOnce(ctx.cwd, provider, imageName, deps.image?.buildImage || buildSandboxImage);
						ctx.ui.notify(`Built Sandcastle ${provider} image ${imageName}.`, "success");
					}
					if (action.type === "sandcastle-init") {
						const cfg = await loadConfig(ctx.cwd);
						const result = await ensureSandcastleCliScaffold(ctx.cwd, cfg, { reinitialize: true });
						ctx.ui.notify(`Initialized execution scaffold: ${result.changes.join("; ")}. Rebuild the sandbox image separately when needed.`, "success");
					}
				}
				if (actions.length > 1) {
					ctx.ui.notify(`Saved ${actions.length} Agent Workflows config change(s). Rebuild the sandbox image separately when needed.`, "success");
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("work:config-raw", {
		description: "Show, init, edit, reset, or validate Agent Workflows config",
		getArgumentCompletions: (prefix: string) => scConfigCompletionItems(prefix),
		handler: async (args, ctx) => {
			const input = args.trim();
			const [subcommand = "show", ...rest] = input ? input.split(/\s+/) : ["show"];
			try {
				switch (subcommand) {
					case "show": {
						const cfg = await loadConfig(ctx.cwd);
						ctx.ui.notify(JSON.stringify(configForPresentation(cfg), null, 2), "info");
						break;
					}
					case "init": {
						const overwrite = rest.includes("--force") || rest.includes("--overwrite");
						if (existsSync(join(ctx.cwd, CONFIG_PATH)) && !overwrite) {
							ensureScaffold(ctx.cwd, { hydrate: false });
							ctx.ui.notify(`${CONFIG_PATH} already exists. Use /work:config-raw init --force to overwrite it with defaults.`, "warning");
							break;
						}
						const result = ensureScaffold(ctx.cwd, { overwrite, hydrate: false });
						const changeSummary = result.changes.length ? result.changes.join("; ") : "no changes needed";
						const overwriteSummary = result.overwritten.length ? ` Overwrote: ${result.overwritten.join(", ")}.` : "";
						ctx.ui.notify(`Agent Workflows config init complete: ${changeSummary}.${overwriteSummary} Rebuild the sandbox image separately when needed.`, "success");
						break;
					}
					case "edit": {
						const configPath = ensureScaffoldPath(ctx.cwd);
						const editor = rest.join(" ").trim() || undefined;
						if (ctx.mode === "tui" && ctx.ui?.custom) {
							const exitCode = await ctx.ui.custom<number | null>((tui: any, _theme: any, _kb: any, done: (value: number | null) => void) => {
								tui.stop();
								process.stdout.write("\x1b[2J\x1b[H");
								const status = runTerminalEditor(ctx.cwd, configPath, editor);
								tui.start();
								tui.requestRender(true);
								done(status);
								return { render: () => [], invalidate: () => {} };
							});
							ctx.ui.notify(exitCode === 0 ? `Edited ${CONFIG_PATH}.` : `Editor exited with code ${exitCode}.`, exitCode === 0 ? "success" : "error");
						} else {
							ctx.ui.notify(`Open ${configPath} in your editor, or run in TUI mode for /work:config edit.`, "info");
						}
						break;
					}
					case "editor": {
						const editor = rest.join(" ").trim();
						if (!editor) {
							ctx.ui.notify(getPreferredEditor(ctx.cwd), "info");
							break;
						}
						setPreferredEditor(ctx.cwd, editor);
						ctx.ui.notify(`Preferred Agent Workflows config editor set to: ${editor}`, "success");
						break;
					}
					case "get": {
						const path = rest.shift();
						if (!path) {
							ctx.ui.notify("Usage: /work:config get <path>", "error");
							break;
						}
						const cfg = configForPresentation(await loadConfig(ctx.cwd));
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
							ctx.ui.notify("Usage: /work:config set <path> <value>", "error");
							break;
						}
						if (!supportedConfigPath(path)) {
							ctx.ui.notify(`Unsupported config path '${path}'.`, "error");
							break;
						}
						const current = readConfigText(ctx.cwd);
						const updated = setConfigValueInText(current, path, parseScalar(rawValue));
						writeConfigText(ctx.cwd, updated);
						ctx.ui.notify(`Updated ${path}. Rebuild the sandbox image separately when needed.`, "success");
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
						ctx.ui.notify(path ? `Reset ${path} to defaults. Rebuild the sandbox image separately when needed.` : "Reset supported config paths to defaults. Rebuild the sandbox image separately when needed.", "success");
						break;
					}
					case "validate": {
						let cfg: SandcastleConfig;
						try {
							cfg = await loadExistingConfig(ctx.cwd);
						} catch {
							cfg = { prompts: {}, agents: {}, chains: {}, pipelines: {} };
						}
						const issues = validateConfig(ctx.cwd, cfg);
						if (issues.length) ctx.ui.notify(`Agent Workflows config validation failed:\n- ${issues.join("\n- ")}`, "error");
						else ctx.ui.notify("Agent Workflows config validation passed.", "success");
						break;
					}
					default:
						ctx.ui.notify(`Unknown /work:config subcommand '${subcommand}'. Use show, init, edit, editor, get, set, reset, or validate.`, "error");
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
			refreshWidget();
		},
	});

	pi.registerCommand("work:pipeline", {
		description: "Run a graph-native or legacy-compatible pipeline: /work:pipeline <pipeline> [prompt]",
		getArgumentCompletions: (prefix: string) => pipelineCompletionItems(tokenAfterLastSpace(prefix)),
		handler: async (args, ctx) => {
			if (isConfigImageRebuildInProgress()) {
				ctx.ui.notify("The sandbox image is being rebuilt after config changes. Retry /work:pipeline when the new image is built.", "warning");
				return;
			}
			const { pipeline, prompt } = parsePipelineCommandArgs(args);
			if (!pipeline) {
				ctx.ui.notify("Usage: /work:pipeline <pipeline> [prompt]", "error");
				return;
			}
			try {
				const record = await executePipeline(ctx.cwd, pipeline, prompt, { ...deps.pipeline, image: deps.pipeline?.image || deps.image });
				const stepSummary = record.steps.map((step) => `${step.role}:${step.status}`).join(", ");
				ctx.ui.notify(
					`Pipeline ${record.pipeline} completed as ${record.id}. Branch: ${record.branch || record.worktreePath || "unknown"}. Logs: ${record.logDir}. Steps: ${stepSummary || "none"}.`,
					"success",
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("work:process", {
		description: "Start durable graph Work processing: /work:process [query] --pipeline <pipeline>",
		getArgumentCompletions: (prefix: string) => {
			const pipelineMatch = prefix.match(/(?:^|\s)(?:--pipeline\s+|-p\s+)(\S*)$/);
			if (pipelineMatch) return pipelineCompletionItems(pipelineMatch[1] || "");
			return flagCompletionItems(["--pipeline", "-p", "--plan"], tokenAfterLastSpace(prefix));
		},
		handler: async (args, ctx) => {
			if (isConfigImageRebuildInProgress()) {
				ctx.ui.notify("The sandbox image is being rebuilt after config changes. Retry /work:process when the new image is built.", "warning");
				return;
			}
			try {
				const { query, pipeline: explicitPipeline, planId } = parseBacklogProcessArgs(args);
				const cfg = await loadConfig(ctx.cwd);
				const { record: finalRecord, recordPath, advisoryNotes = [] } = await runWorkProcess(
					{
						cwd: ctx.cwd,
						query,
						explicitPipeline,
						planId,
						defaultPipeline: cfg.defaultPipeline,
						now: () => getBacklogTimestamp(backlogDeps.now),
						createRunId: createBacklogRunId,
					},
					{
						readPlanRecord: readBacklogPlanRecord,
						plan: planBacklogProcessing,
						execute: (cwd, input) => executeBacklogProcessing(cwd, input, ctx),
						writeRecord: writeWorkProcessRunRecord,
					},
				);
				ctx.ui.notify(
					formatWorkProcessSummary({ record: finalRecord, recordPath, advisoryNotes }),
					finalRecord.status === "done" ? "success" : "error",
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("work:help", {
		description: "Show Agent Workflows command help",
		handler: async (_args, ctx) => ctx.ui.notify(helpText(), "info"),
	});

	pi.registerCommand("work:ready", {
		description: "List deterministic ready Work candidates from the configured Work Source: /work:ready [query]",
		handler: async (args, ctx) => notifyBacklogReady(args, ctx),
	});

	pi.registerCommand("work:plan", {
		description: "Run and cache the Work planning phase: /work:plan [query] --iterations N",
		getArgumentCompletions: (prefix: string) => flagCompletionItems(["--iterations", "--iterations=2", "--all", "--include-terminal"], tokenAfterLastSpace(prefix)),
		handler: async (args, ctx) => notifyBacklogPlan(args, ctx),
	});

	pi.registerCommand("work:next", {
		description: "Plan the next Work iteration: /work:next [query]",
		handler: async (args, ctx) => notifyBacklogPlan(args, ctx, { iterations: 1 }),
	});

	registerWorkCommands(pi);
	pi.registerCommand("work:runs", {
		description: "List Work Process runs: /work:runs [query]",
		handler: async (args, ctx) => {
			const runs = listWorkRuns(ctx.cwd, args.trim());
			ctx.ui.notify(formatWorkRunList(runs), "info");
		},
	});

	pi.registerCommand("work:status", {
		description: "Inspect a Work Process run: /work:status [run-id]",
		handler: async (args, ctx) => {
			const selection = selectWorkRunForStatus(listWorkRuns(ctx.cwd), args.trim());
			const message = formatStatusSelection(selection);
			ctx.ui.notify(message, selection.kind === "record" ? "info" : "error");
		},
	});

	pi.registerCommand("work:logs", {
		description: "Show log paths for a Work Process run: /work:logs [run-id]",
		handler: async (args, ctx) => {
			const selection = selectWorkRunForStatus(listWorkRuns(ctx.cwd), args.trim());
			if (selection.kind !== "record") {
				ctx.ui.notify(formatStatusSelection(selection), "error");
				return;
			}
			const logs = selection.record.logs || [];
			ctx.ui.notify(logs.length ? logs.join("\n") : `No logs recorded for Work Process ${selection.record.id}.`, "info");
		},
	});

	pi.registerCommand("work:cancel", {
		description: "Cancel active Work Process work: /work:cancel [run-id]",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Work Process cancellation is not available for completed durable records yet.", "error");
		},
	});

	pi.registerCommand("work:resume", {
		description: "Resume a Work Process run: /work:resume [run-id]",
		handler: async (args, ctx) => {
			const resumeCapability = getBacklogResumeCapability(ctx);
			const result = await resumeWorkRun(ctx.cwd, args.trim(), resumeCapability);
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
				agent: { type: "string", description: "Configured agent name from .pi/sandcastle/config.yaml" },
				task: { type: "string", description: "Self-contained delegated task prompt" },
			},
			required: ["agent", "task"],
			additionalProperties: false,
		}),
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			if (isConfigImageRebuildInProgress()) {
				return { content: [{ type: "text", text: "The sandbox image is being rebuilt after config changes. Retry delegate_agent when the new image is built." }] };
			}
			const { agent, task } = params as { agent: string; task: string };
			await loadConfig(ctx.cwd);
			onUpdate?.({ content: [{ type: "text", text: `Dispatching ${agent} via Sandcastle...` }] });
			const run = await dispatch(ctx.cwd, agent, task, ctx);
			return {
				content: [{ type: "text", text: `Dispatched ${agent} as ${run.id}. Branch: ${run.branch}. Log: ${run.logPath}. Result: ${run.resultPath}. Use /work:runs for progress.` }],
				details: { id: run.id, agent, branch: run.branch, logPath: run.logPath, resultPath: run.resultPath },
			};
		},
	});
}
