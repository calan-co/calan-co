import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const RUNS_DIR = ".pi/sandcastle/runs";
const NO_RUNS_MESSAGE = "No Sandcastle runs are recorded for this repo.";

function compareRunsByNewest(a, b) {
	return b.updatedAt - a.updatedAt || b.startedAt - a.startedAt || String(a.id).localeCompare(String(b.id));
}

function orderRunsByNewest(runs) {
	return [...runs].sort(compareRunsByNewest);
}

function runsDirPath(cwd) {
	return join(cwd, RUNS_DIR);
}

export function runFilePath(cwd, id) {
	return join(runsDirPath(cwd), `${id}.json`);
}

function ensureRunsDir(cwd) {
	mkdirSync(runsDirPath(cwd), { recursive: true });
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function toTime(value, fallback = Date.now()) {
	if (Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) return numeric;
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

function inferRunKind(run) {
	if (run.kind) return run.kind;
	if (Array.isArray(run.steps)) return "pipeline";
	if (run.resolvedItems || run.itemIds || run.query) return "work-process";
	return "direct-role";
}

function normalizeRunRecord(cwd, run) {
	const root = resolve(cwd);
	const startedAt = toTime(run.startedAt ?? run.createdAt, Date.now());
	return {
		...run,
		kind: inferRunKind(run),
		repoRoot: run.repoRoot || root,
		startedAt,
		updatedAt: toTime(run.updatedAt ?? run.finishedAt ?? run.completedAt ?? run.createdAt ?? run.startedAt, startedAt),
		status: run.status || "running",
		agent: run.agent || run.role,
		commits: Array.isArray(run.commits) ? run.commits : [],
	};
}

function isRunInRepo(repoRoot, run) {
	return run.repoRoot === repoRoot;
}

function isRunningRun(run) {
	return run.status === "running";
}

function canResumeRun(run) {
	return run.resumable || run.providerSessionId || run.sessionId;
}

function resumeUnsupportedError(runId) {
	return `Sandcastle run '${runId}' cannot be resumed: missing provider session metadata or unsupported provider.`;
}

function findRunById(runs, id) {
	return runs.find((candidate) => candidate.id === id) || null;
}

export function createFileRunStore() {
	async function listRuns(cwd) {
		const dir = runsDirPath(cwd);
		if (!existsSync(dir)) return [];
		const repoRoot = resolve(cwd);
		const runs = [];

		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			let path;
			if (entry.isFile() && entry.name.endsWith(".json")) path = join(dir, entry.name);
			else if (entry.isDirectory()) path = join(dir, entry.name, "record.json");
			if (!path || !existsSync(path)) continue;

			try {
				const run = normalizeRunRecord(cwd, readJson(path));
				if (isRunInRepo(repoRoot, run)) runs.push(run);
			} catch {
				continue;
			}
		}

		return runs.sort(compareRunsByNewest);
	}

	async function readRun(cwd, id) {
		const path = runFilePath(cwd, id);
		if (existsSync(path)) return normalizeRunRecord(cwd, readJson(path));
		const nestedPath = join(runsDirPath(cwd), id, "record.json");
		if (existsSync(nestedPath)) return normalizeRunRecord(cwd, readJson(nestedPath));
		return null;
	}

	async function writeRun(cwd, run) {
		ensureRunsDir(cwd);
		const normalized = normalizeRunRecord(cwd, run);
		writeFileSync(runFilePath(cwd, normalized.id), `${JSON.stringify(normalized, null, 2)}\n`);
		return normalized;
	}

	async function updateRun(cwd, id, patch) {
		const current = await readRun(cwd, id);
		if (!current) return null;
		const next = normalizeRunRecord(cwd, {
			...current,
			...patch,
			id,
			updatedAt: Date.now(),
		});
		await writeRun(cwd, next);
		return next;
	}

	async function deleteRun(cwd, id) {
		const path = runFilePath(cwd, id);
		if (existsSync(path)) rmSync(path);
	}

	return {
		listRuns,
		readRun,
		writeRun,
		updateRun,
		deleteRun,
	};
}

export function createMemoryRunStore(seed = []) {
	const runs = new Map(seed.map((run) => [run.id, { ...run }]));

	async function listRuns() {
		return orderRunsByNewest(runs.values());
	}

	async function readRun(_cwd, id) {
		return runs.get(id) ? { ...runs.get(id) } : null;
	}

	async function writeRun(_cwd, run) {
		runs.set(run.id, { ...normalizeRunRecord(".", run) });
		return { ...runs.get(run.id) };
	}

	async function updateRun(_cwd, id, patch) {
		const current = runs.get(id);
		if (!current) return null;
		const next = { ...current, ...patch, id, updatedAt: patch.updatedAt || Date.now() };
		runs.set(id, { ...normalizeRunRecord(".", next) });
		return { ...runs.get(id) };
	}

	async function deleteRun(_cwd, id) {
		runs.delete(id);
	}

	return {
		listRuns,
		readRun,
		writeRun,
		updateRun,
		deleteRun,
	};
}

export function selectRun(runs, id) {
	const ordered = orderRunsByNewest(runs);
	if (id) {
		const run = findRunById(ordered, id);
		return run ? { run } : { error: `Unknown Sandcastle run '${id}' in this repo.` };
	}
	const active = ordered.filter(isRunningRun);
	if (active.length > 1) {
		return { error: `Ambiguous Sandcastle run selection: ${active.map((run) => run.id).join(", ")} are active. Pass a run id.` };
	}
	if (active.length === 1) return { run: active[0] };
	if (ordered.length === 0) return { error: NO_RUNS_MESSAGE };
	return { run: ordered[0] };
}

export function selectCancelableRuns(runs, selector) {
	const ordered = orderRunsByNewest(runs);
	if (!selector || selector === "all") {
		const active = ordered.filter(isRunningRun);
		if (active.length === 0) return { error: "No active Sandcastle runs to cancel." };
		return { runs: active };
	}
	const target = findRunById(ordered, selector);
	if (!target) return { error: `Unknown Sandcastle run '${selector}' in this repo.` };
	if (!isRunningRun(target)) return { error: `Sandcastle run '${selector}' is not active and cannot be cancelled.` };
	return { runs: [target] };
}

export function selectResumableRun(runs, selector) {
	const ordered = orderRunsByNewest(runs);
	if (selector) {
		const run = findRunById(ordered, selector);
		return run ? { run } : { error: `Unknown Sandcastle run '${selector}' in this repo.` };
	}
	const resumable = ordered.filter(canResumeRun).filter((run) => run.status !== "completed");
	if (resumable.length === 0) return { error: "No resumable Sandcastle run is available in this repo." };
	if (resumable.length > 1) {
		return { error: `Ambiguous resumable Sandcastle runs: ${resumable.map((run) => run.id).join(", ")}. Pass a run id.` };
	}
	return { run: resumable[0] };
}

function controllerFor(controllers, runId) {
	if (!controllers) return null;
	if (controllers instanceof Map) return controllers.get(runId) || null;
	return controllers[runId] || null;
}

function readRunLogs(run) {
	if (!run.logPath) return { error: `Sandcastle run '${run.id}' does not record a log path.` };
	if (!existsSync(run.logPath)) return { error: `Sandcastle run '${run.id}' log file is missing: ${run.logPath}` };
	return { logPath: run.logPath };
}

function formatRunSummary(run) {
	const lines = [
		`Run ${run.id}: ${run.status}`,
		`Kind: ${run.kind || "run"}`,
		`Agent: ${run.agent || run.pipeline || "unknown"}`,
		`Started: ${new Date(run.startedAt).toISOString()}`,
	];
	if (run.updatedAt) lines.push(`Updated: ${new Date(run.updatedAt).toISOString()}`);
	if (run.branch) lines.push(`Branch: ${run.branch}`);
	if (run.commits?.length) lines.push(`Commits: ${run.commits.join(", ")}`);
	if (run.logPath) lines.push(`Log: ${run.logPath}`);
	if (run.resultPath) lines.push(`Result: ${run.resultPath}`);
	return lines.join("\n");
}

function formatRunList(runs) {
	if (runs.length === 0) return NO_RUNS_MESSAGE;
	const lines = [`Sandcastle runs (${runs.length})`];
	for (const run of runs) {
		const parts = [`${run.id}`, run.kind || "run", run.status, run.agent || run.pipeline || "unknown"];
		if (run.branch) parts.push(run.branch);
		if (run.updatedAt) parts.push(new Date(run.updatedAt).toISOString());
		lines.push(`- ${parts.join(" · ")}`);
	}
	return lines.join("\n");
}

export function createRunManagementService({ store, controllers, now = () => Date.now() } = {}) {
	const runStore = store || createFileRunStore();

	async function updateRunWithTimestamp(cwd, runId, patch, timestamp = now()) {
		return runStore.updateRun(cwd, runId, {
			...patch,
			updatedAt: timestamp,
		});
	}

	return {
		async list(cwd) {
			const runs = await runStore.listRuns(cwd);
			return { runs, message: formatRunList(runs) };
		},
		async status(cwd, selector) {
			const runs = await runStore.listRuns(cwd);
			const selected = selectRun(runs, selector);
			if (selected.error) return { error: selected.error };
			return { run: selected.run, message: formatRunSummary(selected.run) };
		},
		async logs(cwd, selector) {
			const runs = await runStore.listRuns(cwd);
			const selected = selectRun(runs, selector);
			if (selected.error) return { error: selected.error };
			return readRunLogs(selected.run);
		},
		async cancel(cwd, selector) {
			const runs = await runStore.listRuns(cwd);
			const selected = selectCancelableRuns(runs, selector);
			if (selected.error) return { error: selected.error };
			const activeRunsToCancel = selected.runs.map((run) => ({
				run,
				controller: controllerFor(controllers, run.id),
			}));
			for (const { run, controller } of activeRunsToCancel) {
				if (!controller?.cancel) return { error: `Sandcastle run '${run.id}' has no injected active-run controller.` };
			}
			const cancelledAt = now();
			const updated = [];
			for (const { run, controller } of activeRunsToCancel) {
				await controller.cancel();
				updated.push(
					await updateRunWithTimestamp(cwd, run.id, {
						status: "cancelled",
						cancelledAt,
						endedAt: cancelledAt,
					}, cancelledAt),
				);
			}
			const cancelledRuns = updated.filter(Boolean);
			return { runs: cancelledRuns, message: `Cancelled ${cancelledRuns.length} Sandcastle run(s).` };
		},
		async resume(cwd, selector) {
			const runs = await runStore.listRuns(cwd);
			const selected = selectResumableRun(runs, selector);
			if (selected.error) return { error: selected.error };
			if (!selected.run.resumable || !(selected.run.providerSessionId || selected.run.sessionId)) {
				return { error: resumeUnsupportedError(selected.run.id) };
			}
			const controller = controllerFor(controllers, selected.run.id);
			if (!controller?.resume) {
				return { error: resumeUnsupportedError(selected.run.id) };
			}
			await controller.resume();
			const resumedAt = now();
			const updated = await updateRunWithTimestamp(cwd, selected.run.id, { status: "running", resumedAt }, resumedAt);
			return { run: updated, message: `Resumed Sandcastle run '${selected.run.id}'.` };
		},
	};
}

function normalizeSelector(args) {
	return args.trim() || undefined;
}

function notifyResult(ctx, result, formatSuccessMessage) {
	const message = result.error || formatSuccessMessage(result);
	ctx.ui.notify(message, result.error ? "error" : "info");
}

export function registerRunManagementCommands(pi, options = {}) {
	const service = createRunManagementService(options);
	const commandDefs = [
		[
			"work:runs",
			"Show durable Sandcastle runs for the current repo",
			async (_args, ctx) => {
				notifyResult(ctx, await service.list(ctx.cwd), (result) => result.message);
			},
		],
		[
			"work:status",
			"Inspect a durable Sandcastle run",
			async (args, ctx) => {
				notifyResult(ctx, await service.status(ctx.cwd, normalizeSelector(args)), (result) => result.message);
			},
		],
		[
			"work:logs",
			"Show the log path for a durable Sandcastle run",
			async (args, ctx) => {
				notifyResult(ctx, await service.logs(ctx.cwd, normalizeSelector(args)), (result) => `Log path: ${result.logPath}`);
			},
		],
		[
			"work:cancel",
			"Cancel one or more active Sandcastle runs",
			async (args, ctx) => {
				notifyResult(ctx, await service.cancel(ctx.cwd, normalizeSelector(args)), (result) => result.message);
			},
		],
		[
			"work:resume",
			"Resume a resumable Sandcastle run",
			async (args, ctx) => {
				notifyResult(ctx, await service.resume(ctx.cwd, normalizeSelector(args)), (result) => result.message);
			},
		],
	];

	for (const [name, description, handler] of commandDefs) {
		pi.registerCommand(name, { description, handler });
	}
}
