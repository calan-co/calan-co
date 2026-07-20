export const GLOBAL_NODE_DISCRIMINATOR = "kind" as const;
export const MERGEABLE_RESULT_INTERFACE = "IMergeableResult" as const;

export interface ResultContract {
	resultType: string;
	interfaces: string[];
	accepts: string[];
}

export interface WorkflowNodeModel {
	kind: string;
	needs?: string[];
	nodes?: Record<string, WorkflowNodeModel>;
	mode?: "sequential" | "parallel";
	each?: unknown;
	max?: number;
	with?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface WorkflowValidationDiagnostic {
	path: string;
	message: string;
}

export interface WorkflowValidationResult {
	valid: boolean;
	errors: string[];
	diagnostics: WorkflowValidationDiagnostic[];
	model?: WorkflowNodeModel;
}

export const RESULT_CONTRACTS: Record<string, ResultContract> = Object.freeze({
	composite: Object.freeze({ resultType: "CompositeResult", interfaces: [], accepts: [] }),
	loop: Object.freeze({ resultType: "LoopResult", interfaces: [], accepts: [] }),
	agent: Object.freeze({ resultType: "AgentResult", interfaces: [], accepts: [] }),
	script: Object.freeze({ resultType: "ScriptResult", interfaces: [], accepts: [] }),
	"git.worktree": Object.freeze({ resultType: "WorkspaceResult", interfaces: [MERGEABLE_RESULT_INTERFACE], accepts: [] }),
	"git.merge": Object.freeze({ resultType: "GitMergeResult", interfaces: [], accepts: [MERGEABLE_RESULT_INTERFACE] }),
	"podman.container": Object.freeze({ resultType: "ContainerResult", interfaces: [], accepts: [] }),
	"docker.container": Object.freeze({ resultType: "ContainerResult", interfaces: [], accepts: [] }),
});

const NODE_KINDS_WITH_CHILDREN = new Set(["composite", "loop", "git.worktree", "podman.container", "docker.container"]);
const PROVIDER_SELECTOR_FIELDS = new Set(["provider", "using"]);
const NODE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

interface ValidationContext {
	diagnostics: WorkflowValidationDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatError(path: string, message: string): string {
	return `${path} ${message}`;
}

function addError(ctx: ValidationContext, path: string, message: string): void {
	ctx.diagnostics.push({ path, message: formatError(path, message) });
}

function cloneRecord<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeNeeds(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string") return [value];
	if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return [...value];
	return undefined;
}

function childNodeEntries(value: Record<string, unknown>, path: string, ctx: ValidationContext): Array<[string, WorkflowNodeModel]> {
	if (value.nodes === undefined) return [];
	if (!isRecord(value.nodes)) {
		addError(ctx, `${path}.nodes`, "must be a map keyed by node id");
		return [];
	}
	const entries: Array<[string, WorkflowNodeModel]> = [];
	for (const [id, node] of Object.entries(value.nodes)) {
		if (!NODE_ID_PATTERN.test(id)) addError(ctx, `${path}.nodes.${id}`, "node id must be a map key matching /^[A-Za-z][A-Za-z0-9_-]*$/");
		if (!isRecord(node)) {
			addError(ctx, `${path}.nodes.${id}`, "must be an object");
			continue;
		}
		entries.push([id, node as WorkflowNodeModel]);
	}
	return entries;
}

function deriveNodeContract(kind: string, childContracts: ResultContract[]): ResultContract {
	if (kind === "loop") {
		const childInterfaces = new Set(childContracts.flatMap((contract) => contract.interfaces));
		return {
			resultType: "LoopResult",
			interfaces: childInterfaces.has(MERGEABLE_RESULT_INTERFACE) ? [MERGEABLE_RESULT_INTERFACE] : [],
			accepts: [],
		};
	}
	return RESULT_CONTRACTS[kind] || { resultType: "UnknownResult", interfaces: [], accepts: [] };
}

function validateNeeds(path: string, node: Record<string, unknown>, siblingIds: Set<string> | undefined, ctx: ValidationContext): string[] {
	if (node.needs === undefined) return [];
	const needs = normalizeNeeds(node.needs);
	if (!needs) {
		addError(ctx, path, "needs must be a string or array of strings");
		return [];
	}
	for (const need of needs) {
		if (!siblingIds?.has(need)) addError(ctx, path, `needs unknown sibling '${need}'`);
	}
	return needs;
}

function validateMergeInputs(path: string, needs: string[], siblingContracts: Map<string, ResultContract> | undefined, ctx: ValidationContext): void {
	if (!needs.length) {
		addError(ctx, path, `requires needs that produce ${MERGEABLE_RESULT_INTERFACE}`);
		return;
	}
	for (const need of needs) {
		const contract = siblingContracts?.get(need);
		if (!contract) continue;
		if (!contract.interfaces.includes(MERGEABLE_RESULT_INTERFACE)) {
			addError(ctx, path, `requires needs that produce ${MERGEABLE_RESULT_INTERFACE}; '${need}' produces ${contract.resultType}`);
		}
	}
}

function validateNode(
	path: string,
	node: WorkflowNodeModel,
	siblingIds: Set<string> | undefined,
	ctx: ValidationContext,
): ResultContract {
	const kind = typeof node.kind === "string" ? node.kind : undefined;
	if (!kind) {
		addError(ctx, path, "is missing kind");
	} else if (!RESULT_CONTRACTS[kind]) {
		addError(ctx, path, `references unknown concrete kind '${kind}'`);
	}

	for (const field of PROVIDER_SELECTOR_FIELDS) {
		if (Object.prototype.hasOwnProperty.call(node, field)) addError(ctx, path, `uses provider selector field '${field}'; concrete node type must be selected by kind`);
	}
	if (Object.prototype.hasOwnProperty.call(node, "id")) addError(ctx, path, "must not define id; node ids are map keys");

	validateNeeds(path, node, siblingIds, ctx);

	if (kind === "loop") {
		if (node.mode === undefined) node.mode = "sequential";
		else if (node.mode !== "sequential" && node.mode !== "parallel") addError(ctx, path, "mode must be 'sequential' or 'parallel'");
		if (node.each === undefined) addError(ctx, path, "loop must define each");
		if (node.max !== undefined && (!Number.isInteger(node.max) || node.max < 1)) addError(ctx, path, "max must be a positive integer");
	}

	if (kind && NODE_KINDS_WITH_CHILDREN.has(kind)) {
		if ((kind === "composite" || kind === "loop" || kind === "git.worktree") && node.nodes === undefined) addError(ctx, path, "must define child nodes");
	} else if (node.nodes !== undefined) {
		addError(ctx, path, "must not define child nodes");
	}

	const childContracts = validateChildNodes(path, node, ctx);
	return deriveNodeContract(kind || "", childContracts);
}

function validateChildNodes(path: string, node: WorkflowNodeModel, ctx: ValidationContext): ResultContract[] {
	const entries = childNodeEntries(node, path, ctx);
	if (!entries.length) return [];
	const siblingIds = new Set(entries.map(([id]) => id));
	const siblingContracts = new Map<string, ResultContract>();
	const childContracts: ResultContract[] = [];
	for (const [id, child] of entries) {
		const contract = validateNode(`${path}.nodes.${id}`, child, siblingIds, ctx);
		siblingContracts.set(id, contract);
		childContracts.push(contract);
	}
	for (const [id, child] of entries) {
		if (child.kind === "git.merge") validateMergeInputs(`${path}.nodes.${id}`, normalizeNeeds(child.needs) || [], siblingContracts, ctx);
	}
	return childContracts;
}

export function validateWorkflowModel(value: unknown): WorkflowValidationResult {
	const diagnostics: WorkflowValidationDiagnostic[] = [];
	const ctx: ValidationContext = { diagnostics };
	if (!isRecord(value)) {
		addError(ctx, "root", "must be an object");
		return { valid: false, errors: diagnostics.map((diagnostic) => diagnostic.message), diagnostics };
	}
	const model = cloneRecord(value) as WorkflowNodeModel;
	if (model.kind !== "composite") addError(ctx, "root", "kind must be 'composite'");
	validateNode("root", model, undefined, ctx);
	const errors = diagnostics.map((diagnostic) => diagnostic.message);
	return { valid: errors.length === 0, errors, diagnostics, ...(errors.length === 0 ? { model } : {}) };
}

export function assertValidWorkflowModel(value: unknown): WorkflowNodeModel {
	const result = validateWorkflowModel(value);
	if (result.valid && result.model) return result.model;
	throw new Error(`Invalid Agent Workflows model:\n- ${result.errors.join("\n- ")}`);
}
