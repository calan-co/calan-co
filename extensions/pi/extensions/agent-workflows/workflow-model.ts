import { parse as parseCel } from "@bufbuild/cel";

export const GLOBAL_NODE_DISCRIMINATOR = "kind" as const;
export const MERGEABLE_RESULT_INTERFACE = "IMergeableResult" as const;

export interface ResultContract {
	resultType: string;
	interfaces: string[];
	accepts: string[];
}

export interface WorkflowRefMeta {
	ref: string;
	default?: string;
}

export interface WorkflowCloseFinalizer {
	role?: string;
	prompt?: string;
	promptOverride?: string;
}

export interface WorkflowNodeModel {
	kind?: string;
	$?: WorkflowRefMeta;
	$ref?: string;
	needs?: string[];
	nodes?: Record<string, WorkflowNodeModel>;
	node?: WorkflowNodeModel;
	mode?: "sequential" | "parallel";
	each?: unknown;
	max?: number;
	maxIterations?: number;
	with?: Record<string, unknown>;
	finalize?: WorkflowCloseFinalizer;
	delete?: boolean;
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
	command: Object.freeze({ resultType: "CommandResult", interfaces: [], accepts: [] }),
	"work.close": Object.freeze({ resultType: "WorkCloseResult", interfaces: [], accepts: [] }),
	"git.worktree": Object.freeze({ resultType: "WorkspaceResult", interfaces: [MERGEABLE_RESULT_INTERFACE], accepts: [] }),
	"git.merge": Object.freeze({ resultType: "GitMergeResult", interfaces: [], accepts: [MERGEABLE_RESULT_INTERFACE] }),
	"podman.container": Object.freeze({ resultType: "ContainerResult", interfaces: [], accepts: [] }),
	"docker.container": Object.freeze({ resultType: "ContainerResult", interfaces: [], accepts: [] }),
});

const NODE_KINDS_WITH_CHILDREN = new Set(["composite", "loop", "git.worktree", "podman.container", "docker.container"]);
const SUPPORTED_REF_META_KEYS = new Set(["ref", "default"]);
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
	node.needs = needs;
	for (const need of needs) {
		if (!siblingIds?.has(need)) addError(ctx, path, `needs unknown sibling '${need}'`);
	}
	return needs;
}

function validateWhenMixin(path: string, node: WorkflowNodeModel, ctx: ValidationContext): void {
	if (!Object.prototype.hasOwnProperty.call(node, "when")) return;
	if (typeof node.when !== "string" || !node.when.trim()) {
		addError(ctx, path, "when must be a non-empty CEL expression string");
		return;
	}
	try {
		parseCel(node.when);
	} catch (error) {
		addError(ctx, path, `when must parse as CEL: ${error instanceof Error ? error.message : String(error)}`);
	}
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

function validateMergeDelete(path: string, node: WorkflowNodeModel, kind: string | undefined, ctx: ValidationContext): void {
	if (node.delete === undefined) return;
	if (kind !== "git.merge") addError(ctx, path, "delete is supported only on git.merge nodes");
	if (typeof node.delete !== "boolean") addError(ctx, `${path}.delete`, "must be a boolean");
}

function validateCloseFinalizer(path: string, node: WorkflowNodeModel, kind: string | undefined, ctx: ValidationContext): void {
	if (!Object.prototype.hasOwnProperty.call(node, "finalize")) return;
	if (kind !== "work.close") addError(ctx, path, "finalize is supported only on work.close nodes");
	if (!isRecord(node.finalize)) {
		addError(ctx, `${path}.finalize`, "must be an object");
		return;
	}
	const finalizer = node.finalize;
	const hasPrompt = typeof finalizer.prompt === "string" && finalizer.prompt.trim().length > 0;
	const hasPromptOverride = typeof finalizer.promptOverride === "string" && finalizer.promptOverride.trim().length > 0;
	if (!hasPrompt && !hasPromptOverride) addError(ctx, `${path}.finalize`, "must define prompt or promptOverride");
}

function validateRefMeta(path: string, node: WorkflowNodeModel, ctx: ValidationContext): boolean {
	if (node.$ === undefined && node.$ref === undefined) return false;
	if (node.kind !== undefined) addError(ctx, path, "must not combine $ref metadata with kind");
	if (node.node !== undefined || node.nodes !== undefined) addError(ctx, path, "must not combine $ref metadata with child nodes");
	if (node.$ !== undefined && node.$ref !== undefined) addError(ctx, path, "must not combine $ and $ref metadata");
	for (const key of Object.keys(node)) {
		if (!["$", "$ref", "needs", "capabilities", "with"].includes(key)) addError(ctx, path, `uses unsupported $ref node field '${key}'`);
	}
	if (node.$ref !== undefined) {
		if (typeof node.$ref !== "string" || !node.$ref.trim()) addError(ctx, path, "$ref must be a non-empty string");
		return true;
	}
	if (!isRecord(node.$)) {
		addError(ctx, `${path}.$`, "must be an object");
		return true;
	}
	for (const key of Object.keys(node.$)) if (!SUPPORTED_REF_META_KEYS.has(key)) addError(ctx, path, `uses unsupported $ meta key '${key}'`);
	if (typeof node.$.ref !== "string" || !node.$.ref.trim()) addError(ctx, path, "$.ref must be a non-empty string");
	if (node.$.default !== undefined && (typeof node.$.default !== "string" || !node.$.default.trim())) addError(ctx, path, "$.default must be a non-empty string when provided");
	return true;
}

function validateNode(
	path: string,
	node: WorkflowNodeModel,
	siblingIds: Set<string> | undefined,
	ctx: ValidationContext,
): ResultContract {
	if (validateRefMeta(path, node, ctx)) {
		validateNeeds(path, node, siblingIds, ctx);
		return { resultType: "RefResult", interfaces: [], accepts: [] };
	}
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
	validateWhenMixin(path, node, ctx);
	if (kind === "command" && (typeof node.command !== "string" || !node.command.trim())) addError(ctx, path, "command nodes must define a non-empty command string");
	if (node.maxIterations !== undefined && (!Number.isInteger(node.maxIterations) || node.maxIterations < 1)) addError(ctx, path, "maxIterations must be a positive integer");
	validateCloseFinalizer(path, node, kind, ctx);
	validateMergeDelete(path, node, kind, ctx);

	validateNeeds(path, node, siblingIds, ctx);

	if (kind === "loop") {
		if (node.mode === undefined) node.mode = "sequential";
		else if (node.mode !== "sequential" && node.mode !== "parallel") addError(ctx, path, "mode must be 'sequential' or 'parallel'");
		if (node.mode === "parallel" && node.each === undefined) addError(ctx, path, "parallel loop must define each");
		if (node.max !== undefined && (!Number.isInteger(node.max) || node.max < 1)) addError(ctx, path, "max must be a positive integer");
		const hasNode = Object.prototype.hasOwnProperty.call(node, "node");
		const hasNodes = Object.prototype.hasOwnProperty.call(node, "nodes");
		if (!hasNode && !hasNodes) addError(ctx, path, "loop must define node or nodes");
		if (hasNode && hasNodes) addError(ctx, path, "loop must define exactly one of node or nodes");
	}

	if (kind && NODE_KINDS_WITH_CHILDREN.has(kind)) {
		if (kind === "composite" || kind === "git.worktree") {
			if (node.nodes === undefined) addError(ctx, path, "must define child nodes");
			else if (isRecord(node.nodes) && Object.keys(node.nodes).length === 0) addError(ctx, path, "must define at least one child node");
		}
		if (kind === "loop" && node.nodes !== undefined && isRecord(node.nodes) && Object.keys(node.nodes).length === 0) addError(ctx, path, "must define at least one child node");
	} else if (node.nodes !== undefined) {
		addError(ctx, path, "must not define child nodes");
	}

	const childContracts = validateChildNodes(path, node, ctx);
	return deriveNodeContract(kind || "", childContracts);
}

function validateChildNodes(path: string, node: WorkflowNodeModel, ctx: ValidationContext): ResultContract[] {
	if (node.node !== undefined) {
		if (!isRecord(node.node)) {
			addError(ctx, `${path}.node`, "must be an object");
			return [];
		}
		return [validateNode(`${path}.node`, node.node as WorkflowNodeModel, undefined, ctx)];
	}
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
