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
	kind?: "workPlan" | "work-plan";
	scope?: "forecast" | "actionable";
	query?: string;
	actionable?: WorkPlanResult;
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

export interface WorkProcessWorkerStatus {
	index: number;
	role: string;
	status: "running" | "completed" | "failed";
	branch?: string;
	commits?: string[];
	logPath?: string;
	error?: string;
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
	workerStatuses?: WorkProcessWorkerStatus[];
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
	workerStatuses?: WorkProcessWorkerStatus[];
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
	advisoryNotes?: string[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
	if (!value || typeof value !== "object") return;
	for (const [field, child] of Object.entries(value as Record<string, unknown>)) {
		if (FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS.has(field)) {
			errors.push(`${scope} must not author execution field '${field}'.`);
			continue;
		}
		validateForbiddenWorkPlanFields(`${scope} ${field}`, child, errors);
	}
}

function formatWorkPlanObject(value: Record<string, unknown>): string {
	return Object.entries(value)
		.map(([key, entry]) => `${key}: ${Array.isArray(entry) ? entry.join(", ") : isRecord(entry) ? formatWorkPlanObject(entry as Record<string, unknown>) : String(entry)}`)
		.join("; ");
}

function normalizeWorkPlanShape(value: unknown): unknown {
	if (!isRecord(value)) return value;
	const plan = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
	if (Array.isArray(plan.iterations)) {
		plan.iterations = plan.iterations.map((iteration) => {
			if (!isRecord(iteration)) return iteration;
			const next: Record<string, unknown> = { ...iteration };
			if (isRecord(next.rationale)) next.rationale = formatWorkPlanObject(next.rationale as Record<string, unknown>);
			if (Array.isArray(next.items)) next.items = next.items.map((item) => typeof item === "string" ? { id: item } : item);
			return next;
		});
	}
	return plan;
}

export function validateExecutablePlanArtifact(plan: any): string[] {
	const errors: string[] = [];
	if (!isRecord(plan)) return ["Planner output must be a JSON object."];
	for (const [field, child] of Object.entries(plan)) {
		if (FORBIDDEN_WORK_PLAN_EXECUTION_FIELDS.has(field)) errors.push(`Plan must not author execution field '${field}'.`);
		else if (field !== "iterations") validateForbiddenWorkPlanFields(`Plan ${field}`, child, errors);
	}
	const normalizedPlan = normalizeWorkPlanShape(plan);
	if (!isRecord(normalizedPlan)) return ["Planner output must be a JSON object."];
	if (normalizedPlan.kind !== undefined && normalizedPlan.kind !== "workPlan" && normalizedPlan.kind !== "work-plan") errors.push("Plan kind must be workPlan when provided.");
	if (normalizedPlan.scope !== undefined && normalizedPlan.scope !== "forecast" && normalizedPlan.scope !== "actionable") errors.push("Plan scope must be forecast or actionable when provided.");
	if (normalizedPlan.schemaVersion !== undefined && normalizedPlan.schemaVersion !== 1) errors.push("Plan schemaVersion must be 1 when provided.");
	validateOptionalString("Plan", normalizedPlan, "summary", errors);
	validateOptionalString("Plan", normalizedPlan, "query", errors);
	if (normalizedPlan.actionable !== undefined) {
		if (!isRecord(normalizedPlan.actionable)) errors.push("Plan actionable must be a Work Plan object.");
		else errors.push(...validateExecutablePlanArtifact(normalizedPlan.actionable).map((error) => `Plan actionable ${error.replace(/^Plan(?:ner output)?\s*/, "")}`));
	}
	if (!Array.isArray(normalizedPlan.iterations)) return [...errors, "Planner output must contain an iterations array."];
	for (const [iterationIndex, iteration] of normalizedPlan.iterations.entries()) {
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

export function normalizeExecutablePlanArtifact(plan: any): WorkPlanResult {
	const errors = validateExecutablePlanArtifact(plan);
	if (errors.length) throw new Error(`Work Plan artifact is not executable:\n- ${errors.join("\n- ")}`);
	const normalized = normalizeWorkPlanShape(plan) as WorkPlanResult;
	normalized.scope = normalized.scope || "actionable";
	if (normalized.actionable) normalized.actionable = normalizeExecutablePlanArtifact(normalized.actionable);
	normalized.iterations = normalized.iterations.map((iteration) => ({
		...iteration,
		items: (iteration.items || []).map((item) => ({ ...item, id: item.id.trim() })),
	}));
	return normalized;
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

function collectPlanItems(plan: WorkPlanResult): WorkItem[] {
	return (plan.iterations || []).flatMap((iteration) => Array.isArray(iteration.items) ? iteration.items : []);
}

function revalidateCachedPlanIteration(input: {
	planId: string;
	plannedIteration: WorkPlanIteration;
	currentPlan: WorkPlanResult;
	advisoryNotes: string[];
}): WorkPlanIteration {
	const plannedItems = Array.isArray(input.plannedIteration.items) ? input.plannedIteration.items : [];
	const currentReadyItems = collectPlanItems(input.currentPlan);
	const currentReadyById = new Map(currentReadyItems.map((item) => [item.id, item]));
	const executableItems: WorkItem[] = [];
	const omittedIds: string[] = [];
	for (const plannedItem of plannedItems) {
		const currentItem = currentReadyById.get(plannedItem.id);
		if (currentItem) executableItems.push(currentItem);
		else omittedIds.push(plannedItem.id);
	}
	if (!executableItems.length) {
		const suffix = omittedIds.length ? ` Omitted no-longer-ready Work Items: ${omittedIds.join(", ")}.` : "";
		throw new Error(`Cached Work Plan '${input.planId}' has no currently ready planned Work Items after revalidation.${suffix}`);
	}
	if (omittedIds.length) {
		input.advisoryNotes.push(`Cached Work Plan '${input.planId}' was revalidated against current readiness; omitted no-longer-ready Work Items: ${omittedIds.join(", ")}.`);
	}
	return { ...input.plannedIteration, items: executableItems };
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
		branches: [],
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
		branches: execution.branches || record.branches,
		logs: execution.logs || [],
		workerStatuses: execution.workerStatuses || record.workerStatuses,
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
	const advisoryNotes: string[] = [];
	if (input.planId) {
		if (!deps.readPlanRecord) throw new Error("Cached Work Plan reading is not configured.");
		const cachedPlanRecord = deps.readPlanRecord(input.cwd, input.planId);
		const cachedPlan = cachedPlanRecord?.plan;
		const validationErrors = validateExecutablePlanArtifact(cachedPlan);
		if (validationErrors.length) throw new Error(`Cached Work Plan '${input.planId}' is not executable:\n- ${validationErrors.join("\n- ")}`);
		const normalizedPlan = normalizeExecutablePlanArtifact(cachedPlan);
		if (normalizedPlan.scope === "forecast") {
			if (!normalizedPlan.actionable) throw new Error(`Cached Work Plan '${input.planId}' is a forecast and does not contain an actionable Work Plan. Re-run /work:plan or process without --plan so current readiness can be derived.`);
			planResult = normalizedPlan.actionable;
			advisoryNotes.push(`Cached Work Plan '${input.planId}' is a forecast; /work:process executed only its actionable section and left forecast iterations advisory.`);
		} else {
			planResult = normalizedPlan;
		}
		planResult = { ...planResult, query: planResult.query || normalizedPlan.query };
	} else {
		planResult = await deps.plan(input.cwd, input.query);
	}

	let iteration = planResult.iterations[0];
	if (!iteration) throw new Error("No Work Items were selected for processing.");
	if (input.planId) {
		const currentPlan = await deps.plan(input.cwd, planResult.query || input.query);
		iteration = revalidateCachedPlanIteration({ planId: input.planId, plannedIteration: iteration, currentPlan, advisoryNotes });
	}

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
		return { record: finalRecord, recordPath, advisoryNotes };
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
