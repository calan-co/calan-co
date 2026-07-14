import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WORK_PROCESS_RUN_KIND = "work-process";
const WORK_PROCESS_RUNS_DIR = ".pi/sandcastle/runs";
const DEFAULT_WORK_PROCESS_PIPELINE = "simple-loop";

export interface WorkItem {
	id: string;
	title?: string;
	summary?: string;
	tags?: string[];
	sourcePath?: string;
	[key: string]: unknown;
}

export interface WorkPlanIteration {
	items?: WorkItem[];
	supportsParallel?: boolean;
	parallelizable?: boolean;
	classifications?: {
		parallelizable?: boolean;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export interface WorkPlanResult {
	query?: string;
	iterations: WorkPlanIteration[];
}

export type WorkProcessStatus = "queued" | "running" | "done" | "error";

export interface WorkExecutionContext {
	contextId: string;
	branch: string;
	groupIndex: number;
	itemIndex: number;
	itemId: string;
}

export interface WorkExecutionGroup {
	index: number;
	parallel: boolean;
	contexts: WorkExecutionContext[];
}

export interface WorkProcessRunRecord {
	id: string;
	kind?: "work-process";
	query: string;
	resolvedItems: WorkItem[];
	pipeline: string;
	planId?: string;
	status: WorkProcessStatus;
	branches: string[];
	logs: string[];
	executionContexts: WorkExecutionContext[];
	executionGroups: WorkExecutionGroup[];
	startedAt: number;
	updatedAt: number;
	endedAt?: number;
}

export interface WorkProcessExecutionInput {
	runId: string;
	query: string;
	pipeline: string;
	items: WorkItem[];
	parallel: boolean;
	executionContexts: WorkExecutionContext[];
	executionGroups: WorkExecutionGroup[];
	recordPath: string;
}

export interface WorkProcessExecutionResult {
	branches?: string[];
	logs?: string[];
	status?: WorkProcessStatus;
}

export interface RunWorkProcessInput {
	cwd: string;
	query: string;
	explicitPipeline?: string;
	planId?: string;
	defaultPipeline?: string;
	now?: () => number;
	createRunId?: (startedAt: number) => string;
}

export interface RunWorkProcessDeps {
	readPlanRecord?: (cwd: string, planId: string) => any;
	plan: (cwd: string, query: string) => Promise<WorkPlanResult>;
	execute: (cwd: string, input: WorkProcessExecutionInput) => Promise<WorkProcessExecutionResult>;
	writeRecord?: (cwd: string, record: WorkProcessRunRecord) => string;
}

export interface RunWorkProcessResult {
	record: WorkProcessRunRecord;
	recordPath: string;
}

export function sanitizeBranchSegment(value: unknown): string {
	const sanitized = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return sanitized || "item";
}

export function deriveWorkExecutionContext(input: {
	runId: string;
	pipeline: string;
	item: Pick<WorkItem, "id">;
	groupIndex: number;
	itemIndex: number;
}): WorkExecutionContext {
	const runSegment = sanitizeBranchSegment(input.runId);
	const pipelineSegment = sanitizeBranchSegment(input.pipeline);
	const itemSegment = sanitizeBranchSegment(input.item.id || `item-${input.itemIndex + 1}`);
	return {
		contextId: `${runSegment}/${itemSegment}/${input.groupIndex}-${input.itemIndex}`,
		branch: `agent-workflows/${pipelineSegment}/${runSegment}/${itemSegment}`,
		groupIndex: input.groupIndex,
		itemIndex: input.itemIndex,
		itemId: input.item.id,
	};
}

const FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS = new Set(["pipeline", "pipelines", "pipelineName", "recommendedPipeline", "recommendedPipelines", "branch", "branches", "branchName"]);

function validateForbiddenWorkPlanFields(scope: string, value: unknown, errors: string[]): void {
	if (Array.isArray(value)) {
		for (const entry of value) validateForbiddenWorkPlanFields(scope, entry, errors);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [field, child] of Object.entries(value as Record<string, unknown>)) {
		if (FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS.has(field)) {
			errors.push(`${scope} must not author execution field '${field}'.`);
			continue;
		}
		validateForbiddenWorkPlanFields(`${scope} ${field}`, child, errors);
	}
}

export function validateExecutablePlanArtifact(plan: any): string[] {
	const errors: string[] = [];
	if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["Planner output must be a JSON object."];
	for (const [field, child] of Object.entries(plan)) {
		if (FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS.has(field)) errors.push(`Plan must not author execution field '${field}'.`);
		else if (field !== "iterations") validateForbiddenWorkPlanFields(`Plan ${field}`, child, errors);
	}
	if (!Array.isArray(plan.iterations)) return [...errors, "Planner output must contain an iterations array."];
	for (const [iterationIndex, iteration] of plan.iterations.entries()) {
		const iterationScope = `Plan iteration ${iterationIndex + 1}`;
		if (!iteration || typeof iteration !== "object" || Array.isArray(iteration)) {
			errors.push(`${iterationScope} must be an object.`);
			continue;
		}
		for (const [field, child] of Object.entries(iteration)) {
			if (FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS.has(field)) errors.push(`${iterationScope} must not author execution field '${field}'.`);
			else if (field !== "items") validateForbiddenWorkPlanFields(`${iterationScope} ${field}`, child, errors);
		}
		if (!Array.isArray(iteration.items)) {
			errors.push(`${iterationScope} must contain an items array.`);
			continue;
		}
		for (const [itemIndex, item] of iteration.items.entries()) {
			const itemScope = `${iterationScope} item ${itemIndex + 1}`;
			if (!item || typeof item !== "object" || Array.isArray(item)) {
				errors.push(`${itemScope} must be an object.`);
				continue;
			}
			for (const [field, child] of Object.entries(item)) {
				if (FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS.has(field)) errors.push(`${itemScope} must not author execution field '${field}'.`);
				else validateForbiddenWorkPlanFields(`${itemScope} ${field}`, child, errors);
			}
			if (typeof item.id !== "string" || !item.id.trim()) {
				errors.push(`${itemScope} is missing a canonical item id.`);
			}
		}
	}
	return errors;
}

export function selectWorkProcessPipeline(input: { explicitPipeline?: string; defaultPipeline?: string }): string {
	return input.explicitPipeline || input.defaultPipeline || DEFAULT_WORK_PROCESS_PIPELINE;
}

export function planIterationSupportsParallel(iteration: any): boolean {
	if (typeof iteration?.parallelizable === "boolean") return iteration.parallelizable;
	if (typeof iteration?.classifications?.parallelizable === "boolean") return iteration.classifications.parallelizable;
	if (typeof iteration?.supportsParallel === "boolean") return iteration.supportsParallel;
	return (iteration?.items || []).length > 1;
}

export function buildExecutionGroups(input: { runId: string; pipeline: string; iteration: WorkPlanIteration }): WorkExecutionGroup[] {
	const items = Array.isArray(input.iteration.items) ? input.iteration.items : [];
	const parallel = planIterationSupportsParallel(input.iteration);
	if (!items.length) return [];
	if (!parallel) {
		return items.map((item, index) => ({
			index,
			parallel: false,
			contexts: [deriveWorkExecutionContext({ runId: input.runId, pipeline: input.pipeline, item, groupIndex: index, itemIndex: index })],
		}));
	}
	return [
		{
			index: 0,
			parallel: true,
			contexts: items.map((item, index) => deriveWorkExecutionContext({ runId: input.runId, pipeline: input.pipeline, item, groupIndex: 0, itemIndex: index })),
		},
	];
}

export function workProcessRunRecordPath(cwd: string, runId: string): string {
	return join(cwd, WORK_PROCESS_RUNS_DIR, `${runId}.json`);
}

export function writeWorkProcessRunRecord(cwd: string, record: WorkProcessRunRecord): string {
	const recordPath = workProcessRunRecordPath(cwd, record.id);
	mkdirSync(join(cwd, WORK_PROCESS_RUNS_DIR), { recursive: true });
	writeFileSync(recordPath, JSON.stringify({ ...record, kind: WORK_PROCESS_RUN_KIND }, null, 2));
	return recordPath;
}

export function createWorkProcessRecord(input: {
	runId: string;
	query: string;
	pipeline: string;
	iteration: WorkPlanIteration;
	planId?: string;
	startedAt: number;
}): WorkProcessRunRecord {
	const items = Array.isArray(input.iteration.items) ? input.iteration.items : [];
	const executionGroups = buildExecutionGroups({ runId: input.runId, pipeline: input.pipeline, iteration: input.iteration });
	const executionContexts = executionGroups.flatMap((group) => group.contexts);
	return {
		id: input.runId,
		kind: WORK_PROCESS_RUN_KIND,
		query: input.query,
		resolvedItems: items,
		pipeline: input.pipeline,
		...(input.planId ? { planId: input.planId } : {}),
		status: "running",
		branches: executionContexts.map((context) => context.branch),
		logs: [],
		executionContexts,
		executionGroups,
		startedAt: input.startedAt,
		updatedAt: input.startedAt,
	};
}

export function applyWorkProcessResult(record: WorkProcessRunRecord, execution: WorkProcessExecutionResult, endedAt: number): WorkProcessRunRecord {
	return {
		...record,
		status: execution.status || "done",
		branches: record.branches,
		logs: execution.logs || [],
		updatedAt: endedAt,
		endedAt,
	};
}

function createDefaultRunId(startedAt: number): string {
	return `work-${startedAt.toString(36)}`;
}

export async function runWorkProcess(input: RunWorkProcessInput, deps: RunWorkProcessDeps): Promise<RunWorkProcessResult> {
	const now = input.now || Date.now;
	let planResult: WorkPlanResult;
	if (input.planId) {
		if (!deps.readPlanRecord) throw new Error("Cached Work Plan reading is not configured.");
		const cachedPlanRecord = deps.readPlanRecord(input.cwd, input.planId);
		const cachedPlan = cachedPlanRecord?.plan;
		const validationErrors = validateExecutablePlanArtifact(cachedPlan);
		if (validationErrors.length) throw new Error(`Cached Work Plan '${input.planId}' is not executable:\n- ${validationErrors.join("\n- ")}`);
		planResult = { query: cachedPlan.query, iterations: cachedPlan.iterations };
	} else {
		planResult = await deps.plan(input.cwd, input.query);
	}

	const iteration = planResult.iterations[0];
	if (!iteration) throw new Error("No Work Items were selected for processing.");

	const pipeline = selectWorkProcessPipeline({ explicitPipeline: input.explicitPipeline, defaultPipeline: input.defaultPipeline });
	const startedAt = now();
	const runId = (input.createRunId || createDefaultRunId)(startedAt);
	const baseRecord = createWorkProcessRecord({
		runId,
		query: planResult.query || input.query,
		pipeline,
		iteration,
		planId: input.planId,
		startedAt,
	});
	const writeRecord = deps.writeRecord || writeWorkProcessRunRecord;
	const recordPath = writeRecord(input.cwd, baseRecord);
	try {
		const execution = await deps.execute(input.cwd, {
			runId,
			query: baseRecord.query,
			pipeline,
			items: baseRecord.resolvedItems,
			parallel: planIterationSupportsParallel(iteration),
			executionContexts: baseRecord.executionContexts,
			executionGroups: baseRecord.executionGroups,
			recordPath,
		});
		const finalRecord = applyWorkProcessResult(baseRecord, execution, now());
		writeRecord(input.cwd, finalRecord);
		return { record: finalRecord, recordPath };
	} catch (error) {
		const endedAt = now();
		const errorRecord: WorkProcessRunRecord = {
			...baseRecord,
			status: "error",
			updatedAt: endedAt,
			endedAt,
		};
		writeRecord(input.cwd, errorRecord);
		throw error;
	}
}
