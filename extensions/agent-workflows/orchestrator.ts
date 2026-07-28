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
	nodePath?: string;
	kind?: string;
	laneId?: string;
	itemId?: string;
}

export interface WorkSourceMutationOutcome {
	itemId: string;
	action: "validate" | "close";
	status: "succeeded" | "failed";
	message?: string;
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
	workSourceMutations?: WorkSourceMutationOutcome[];
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
	workSourceMutations?: WorkSourceMutationOutcome[];
	status?: WorkProcessStatus;
}

export interface RunWorkProcessInput {
	cwd: string;
	query: string;
	explicitPipeline?: string;
	planId?: string;
	defaultPipeline?: string;
	maxIterations?: number;
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

function workItemStringArray(item: WorkItem, key: string): string[] {
	const value = item[key];
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function isHitlWorkItem(item: WorkItem, iteration: WorkPlanIteration): boolean {
	const tags = workItemStringArray(item, "tags").map((tag) => tag.toLowerCase());
	if (tags.some((tag) => tag === "hitl" || tag === "human-in-the-loop" || tag === "human")) return true;
	const iterationHitl = Array.isArray(iteration.hitl) ? iteration.hitl : [];
	return typeof item.id === "string" && iterationHitl.includes(item.id);
}

function isExplicitlyDependencyBlockedWorkItem(item: WorkItem): boolean {
	const status = typeof item.status === "string" ? item.status.toLowerCase() : "";
	const readiness = typeof item.readiness === "string" ? item.readiness.toLowerCase() : "";
	const dependencyState = isRecord(item.dependencyState) && typeof item.dependencyState.status === "string" ? item.dependencyState.status.toLowerCase() : "";
	const classifications = isRecord(item.classifications) && typeof item.classifications.dependencyState === "string" ? item.classifications.dependencyState.toLowerCase() : "";
	return [status, readiness, dependencyState, classifications].some((value) => value === "blocked" || value === "dependency-blocked" || value === "has-dependencies");
}

function normalizeDependencyToken(value: string): string {
	return value.trim().toLowerCase().replace(/^\[\[/, "").replace(/\]\]$/, "").replace(/^backlog\//, "").replace(/\.md$/, "");
}

function workItemReferenceTokens(item: WorkItem): Set<string> {
	const tokens = new Set<string>();
	for (const key of ["id", "sourcePath", "relativePath", "filePath", "title"] as const) {
		const value = item[key];
		if (typeof value === "string" && value.trim()) tokens.add(normalizeDependencyToken(value));
	}
	for (const token of Array.from(tokens)) {
		const numeric = token.match(/(?:^|[^0-9])(\d{3,5})(?:[^0-9]|$)/)?.[1];
		if (numeric) tokens.add(numeric.replace(/^0+/, "") || numeric);
	}
	return tokens;
}

function dependsOnSelectedWorkItem(item: WorkItem, selectedTokens: Set<string>): boolean {
	const dependencies = [...workItemStringArray(item, "dependsOn"), ...workItemStringArray(item, "dependencies")];
	return dependencies.some((dependency) => {
		const normalized = normalizeDependencyToken(dependency);
		const numeric = normalized.match(/(?:^|[^0-9])(\d{3,5})(?:[^0-9]|$)/)?.[1];
		return selectedTokens.has(normalized) || Boolean(numeric && selectedTokens.has(numeric.replace(/^0+/, "") || numeric));
	});
}

function filterExecutableIteration(iteration: WorkPlanIteration): { iteration: WorkPlanIteration; omittedIds: string[] } {
	const items = Array.isArray(iteration.items) ? iteration.items : [];
	const selectedTokens = new Set(items.flatMap((item) => Array.from(workItemReferenceTokens(item))));
	const executable = items.filter((item) => !isExplicitlyDependencyBlockedWorkItem(item) && !dependsOnSelectedWorkItem(item, selectedTokens) && !isHitlWorkItem(item, iteration));
	const executableIds = new Set(executable.map((item) => item.id));
	return {
		iteration: { ...iteration, items: executable },
		omittedIds: items.filter((item) => !executableIds.has(item.id)).map((item) => item.id).filter((id): id is string => typeof id === "string" && id.length > 0),
	};
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
		workSourceMutations: execution.workSourceMutations || record.workSourceMutations,
		updatedAt: endedAt,
		endedAt,
	};
}

function createDefaultRunId(startedAt: number): string {
	return `work-${startedAt.toString(36)}`;
}

function appendUnique<T>(left: T[] | undefined, right: T[] | undefined): T[] {
	return [...(left || []), ...(right || [])];
}

function itemIdSet(items: WorkItem[] | undefined): Set<string> {
	return new Set((items || []).map((item) => item.id).filter((id): id is string => typeof id === "string" && id.length > 0));
}

function closedItemIds(execution: WorkProcessExecutionResult): Set<string> {
	return new Set((execution.workSourceMutations || [])
		.filter((outcome) => outcome.action === "close" && outcome.status === "succeeded")
		.map((outcome) => outcome.itemId));
}

function mergeWorkProcessRecords(base: WorkProcessRunRecord | undefined, wave: WorkProcessRunRecord): WorkProcessRunRecord {
	if (!base) return wave;
	const workerOffset = base.workerStatuses?.length || 0;
	const groupOffset = base.executionGroups.length;
	return {
		...base,
		status: wave.status,
		resolvedItems: appendUnique(base.resolvedItems, wave.resolvedItems),
		branches: appendUnique(base.branches, wave.branches),
		logs: appendUnique(base.logs, wave.logs),
		workerStatuses: appendUnique(base.workerStatuses, wave.workerStatuses?.map((worker) => ({ ...worker, index: worker.index + workerOffset }))),
		workSourceMutations: appendUnique(base.workSourceMutations, wave.workSourceMutations),
		executionContexts: appendUnique(base.executionContexts, wave.executionContexts),
		executionGroups: appendUnique(base.executionGroups, wave.executionGroups.map((group) => ({ ...group, index: group.index + groupOffset }))),
		updatedAt: wave.updatedAt,
		endedAt: wave.endedAt,
	};
}

function selectExecutableIteration(plan: WorkPlanResult, attempted: Set<string>, advisoryNotes: string[]): { iteration?: WorkPlanIteration; repeatedIds: string[]; omittedIds: string[] } {
	const repeated = new Set<string>();
	const omitted = new Set<string>();
	for (const planIteration of plan.iterations || []) {
		const filtered = filterExecutableIteration(planIteration);
		for (const id of filtered.omittedIds) omitted.add(id);
		const executableItems = filtered.iteration.items || [];
		for (const item of executableItems) if (attempted.has(item.id)) repeated.add(item.id);
		const nextItems = executableItems.filter((item) => !attempted.has(item.id));
		if (nextItems.length) {
			if (filtered.omittedIds.length) advisoryNotes.push(`Work readiness was revalidated before execution; omitted non-executable Work Items: ${filtered.omittedIds.join(", ")}.`);
			return { iteration: { ...filtered.iteration, items: nextItems }, repeatedIds: [...repeated], omittedIds: [...omitted] };
		}
	}
	return { repeatedIds: [...repeated], omittedIds: [...omitted] };
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

	const pipeline = selectWorkProcessPipeline({ explicitPipeline: input.explicitPipeline, defaultPipeline: input.defaultPipeline });
	const startedAt = now();
	const runId = (input.createRunId || createDefaultRunId)(startedAt);
	const writeRecord = deps.writeRecord || writeWorkProcessRunRecord;
	const attempted = new Set<string>();
	const maxWaves = Math.max(1, input.maxIterations || 1);
	let aggregateRecord: WorkProcessRunRecord | undefined;
	let recordPath = "";

	for (let wave = 0; wave < maxWaves; wave++) {
		let effectivePlan = planResult;
		if (input.planId && wave === 0) {
			const currentPlan = await deps.plan(input.cwd, planResult.query || input.query);
			const firstIteration = planResult.iterations[0];
			if (!firstIteration) throw new Error("No Work Items were selected for processing.");
			effectivePlan = { ...planResult, iterations: [revalidateCachedPlanIteration({ planId: input.planId, plannedIteration: firstIteration, currentPlan, advisoryNotes })] };
		}
		const selection = selectExecutableIteration(effectivePlan, attempted, advisoryNotes);
		if (!selection.iteration) {
			if (selection.repeatedIds.length) throw new Error(`Work cycle guard stopped processing because ready Work Items repeated: ${selection.repeatedIds.join(", ")}. Ensure the Work Source close/validate hook marks completed work before re-running.`);
			if (!aggregateRecord) throw new Error(`No currently executable Work Items were selected for processing. Omitted non-executable Work Items: ${selection.omittedIds.join(", ") || "none"}.`);
			return { record: aggregateRecord, recordPath, advisoryNotes };
		}

		const waveRecord = createWorkProcessRecord({
			runId,
			query: effectivePlan.query || input.query,
			pipeline,
			iteration: selection.iteration,
			planId: input.planId,
			startedAt,
		});
		const runningRecord = mergeWorkProcessRecords(aggregateRecord, waveRecord);
		recordPath = writeRecord(input.cwd, runningRecord);
		try {
			const execution = await deps.execute(input.cwd, {
				runId,
				query: waveRecord.query,
				pipeline,
				items: waveRecord.resolvedItems,
				parallel: planIterationSupportsParallel(selection.iteration),
				executionContexts: waveRecord.executionContexts,
				executionGroups: waveRecord.executionGroups,
				recordPath,
			});
			const finalWaveRecord = applyWorkProcessResult(waveRecord, execution, now());
			aggregateRecord = mergeWorkProcessRecords(aggregateRecord, finalWaveRecord);
			writeRecord(input.cwd, aggregateRecord);
			const waveItemIds = itemIdSet(selection.iteration.items);
			for (const id of waveItemIds) attempted.add(id);
			if (aggregateRecord.status !== "done") return { record: aggregateRecord, recordPath, advisoryNotes };
			const closed = closedItemIds(execution);
			if (![...waveItemIds].every((id) => closed.has(id))) {
				advisoryNotes.push("Work wave processing stopped after the current wave because the execution result did not confirm Work Source closure for every item.");
				return { record: aggregateRecord, recordPath, advisoryNotes };
			}
			planResult = await deps.plan(input.cwd, input.query);
		} catch (error) {
			const endedAt = now();
			const errorRecord: WorkProcessRunRecord = {
				...waveRecord,
				status: "error",
				updatedAt: endedAt,
				endedAt,
			};
			aggregateRecord = mergeWorkProcessRecords(aggregateRecord, errorRecord);
			writeRecord(input.cwd, aggregateRecord);
			throw error;
		}
	}
	if (aggregateRecord && input.maxIterations) {
		const selection = selectExecutableIteration(planResult, attempted, advisoryNotes);
		if (selection.iteration || selection.repeatedIds.length) throw new Error(`Work wave limit exceeded after ${maxWaves} iteration(s). Increase maxIterations only after confirming completed work is closing in the Work Source.`);
	}
	if (aggregateRecord) return { record: aggregateRecord, recordPath, advisoryNotes };
	throw new Error("No Work Items were selected for processing.");
}
