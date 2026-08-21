/**
 * Cross-terminal handoff extension.
 *
 * /handoff <goal>
 *   Builds an algorithmic handoff prompt for the current Pi session and opens a
 *   fresh Pi in a new terminal/multiplexer surface. It detects cmux, zellij,
 *   tmux, WezTerm, Kitty, Ghostty, Alacritty, iTerm, and Terminal.app, with an
 *   explicit manual/configurable fallback.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const MAX_RECENT_ENTRIES = 24;
const MAX_TEXT_CHARS = 2400;
const MAX_TOOL_CHARS = 1200;
const CMUX_TIMEOUT_MS = 5000;
const CMUX_READY_ATTEMPTS = 20;
const CMUX_READY_DELAY_MS = 150;

interface CmuxExecResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	error?: string;
}

interface CmuxCallerInfo {
	workspace_ref?: string;
	pane_ref?: string;
	surface_ref?: string;
}

interface CmuxPaneInfo {
	ref?: string;
	selected_surface_ref?: string;
	surface_refs?: string[];
}

interface LaunchPlan {
	args: string[];
	display: string;
	title: string;
	piBin: string;
	promptFile: string;
}

interface LaunchContext extends LaunchPlan {
	pi: ExtensionAPI;
	cwd: string;
	diagnostics: string[];
}

type Launcher = (ctx: LaunchContext) => Promise<string | null> | string | null;

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function appleScriptQuote(value: string): string {
	return JSON.stringify(value);
}

function slugify(value: string): string {
	return (value || "handoff")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "handoff";
}

function hasCommand(name: string): boolean {
	return spawnSync("/bin/sh", ["-lc", `command -v ${shellQuote(name)} >/dev/null 2>&1`], {
		stdio: "ignore",
	}).status === 0;
}

function commandPath(name: string): string | undefined {
	const result = spawnSync("/bin/sh", ["-lc", `command -v ${shellQuote(name)}`], { encoding: "utf8" });
	const path = result.stdout.trim();
	return result.status === 0 && path ? path : undefined;
}

function resolvePiBin(): string {
	return commandPath("pi") ?? "pi";
}

function isSshSession(): boolean {
	return Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY || process.env.SSH_CLIENT);
}

function run(cmd: string, args: string[]): boolean {
	const result = spawnSync(cmd, args, { stdio: "ignore", detached: true });
	return result.status === 0;
}

function runDiag(ctx: LaunchContext, label: string, cmd: string, args: string[]): boolean {
	const result = spawnSync(cmd, args, { stdio: "ignore", detached: true });
	if (result.status === 0) return true;
	const reason = result.error instanceof Error ? result.error.message : `exit ${result.status ?? "unknown"}`;
	ctx.diagnostics.push(`${label} failed: ${reason}`);
	return false;
}

function noteSkip(ctx: LaunchContext, label: string, reason: string): null {
	ctx.diagnostics.push(`${label} skipped: ${reason}`);
	return null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson<T>(text: string): T | undefined {
	try {
		return JSON.parse(text) as T;
	} catch {
		return undefined;
	}
}

async function execCmux(pi: ExtensionAPI, args: string[]): Promise<CmuxExecResult> {
	try {
		const result = await pi.exec("cmux", args, { timeout: CMUX_TIMEOUT_MS });
		if (result.killed) {
			return { ok: false, stdout: result.stdout, stderr: result.stderr, error: "cmux command timed out" };
		}
		if (result.code !== 0) {
			return {
				ok: false,
				stdout: result.stdout,
				stderr: result.stderr,
				error: result.stderr.trim() || result.stdout.trim() || `cmux exited with code ${result.code}`,
			};
		}
		return { ok: true, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		return { ok: false, stdout: "", stderr: "", error: error instanceof Error ? error.message : String(error) };
	}
}

function collectSurfaceRefs(panes: CmuxPaneInfo[]): Set<string> {
	const refs = new Set<string>();
	for (const pane of panes) {
		if (pane.selected_surface_ref) refs.add(pane.selected_surface_ref);
		for (const ref of pane.surface_refs ?? []) refs.add(ref);
	}
	return refs;
}

async function cmuxListPanes(pi: ExtensionAPI, workspaceRef: string): Promise<CmuxPaneInfo[] | undefined> {
	const result = await execCmux(pi, ["--json", "list-panes", "--workspace", workspaceRef]);
	if (!result.ok) return undefined;
	return parseJson<{ panes?: CmuxPaneInfo[] }>(result.stdout)?.panes ?? [];
}

async function cmuxWaitForNewSurface(pi: ExtensionAPI, workspaceRef: string, previousPanes: CmuxPaneInfo[]): Promise<string | undefined> {
	const previousPaneRefs = new Set(previousPanes.map((pane) => pane.ref).filter((ref): ref is string => Boolean(ref)));
	const previousSurfaceRefs = collectSurfaceRefs(previousPanes);

	for (let attempt = 0; attempt < CMUX_READY_ATTEMPTS; attempt += 1) {
		const panes = await cmuxListPanes(pi, workspaceRef);
		if (!panes) return undefined;

		for (const pane of panes) {
			if (pane.ref && !previousPaneRefs.has(pane.ref) && pane.selected_surface_ref) return pane.selected_surface_ref;
			const firstNew = pane.surface_refs?.find((ref) => !previousSurfaceRefs.has(ref));
			if (firstNew) return firstNew;
		}

		await sleep(CMUX_READY_DELAY_MS);
	}

	return undefined;
}

async function launchCmux(ctx: LaunchContext): Promise<string | null> {
	if (!hasCommand("cmux")) return noteSkip(ctx, "cmux", "cmux not found");

	const identify = await execCmux(ctx.pi, ["--json", "identify"]);
	if (!identify.ok) return noteSkip(ctx, "cmux", identify.error ?? "not in a cmux caller context");

	const caller = parseJson<{ caller?: CmuxCallerInfo }>(identify.stdout)?.caller;
	const workspaceRef = caller?.workspace_ref;
	const paneRef = caller?.pane_ref;
	if (!workspaceRef || !paneRef) return noteSkip(ctx, "cmux", "identify did not include workspace_ref and pane_ref");

	const beforePanes = await cmuxListPanes(ctx.pi, workspaceRef);
	if (!beforePanes) return noteSkip(ctx, "cmux", "could not list panes");

	const tab = await execCmux(ctx.pi, [
		"new-surface",
		"--type",
		"terminal",
		"--workspace",
		workspaceRef,
		"--pane",
		paneRef,
		"--focus",
		"true",
	]);
	if (!tab.ok) return noteSkip(ctx, "cmux", tab.error ?? "new-surface failed");

	const surfaceRef = await cmuxWaitForNewSurface(ctx.pi, workspaceRef, beforePanes);
	if (!surfaceRef) return noteSkip(ctx, "cmux", "new surface did not become visible");

	await sleep(250);
	const respawn = await execCmux(ctx.pi, [
		"respawn-pane",
		"--workspace",
		workspaceRef,
		"--surface",
		surfaceRef,
		"--command",
		ctx.display,
	]);
	if (!respawn.ok) return noteSkip(ctx, "cmux", respawn.error ?? "respawn-pane failed");

	await execCmux(ctx.pi, ["rename-tab", "--workspace", workspaceRef, "--surface", surfaceRef, "--title", ctx.title]);
	return "cmux tab";
}

function truncate(text: string, max = MAX_TEXT_CHARS): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: any) => {
			if (part?.type === "text") return part.text ?? "";
			if (part?.type) return `[${part.type}]`;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function summarizeEntry(entry: any): string | null {
	const message = entry?.message ?? entry;
	const role = message?.role ?? entry?.role;
	if (!role) return null;

	if (role === "toolResult") {
		const toolName = message.toolName ?? entry.toolName ?? "tool";
		const text = textFromContent(message.content ?? entry.content);
		return `### toolResult: ${toolName}\n${truncate(text, MAX_TOOL_CHARS)}`;
	}

	if (role === "assistant" || role === "user" || role === "system") {
		const text = textFromContent(message.content ?? entry.content);
		if (!text.trim()) return null;
		return `### ${role}\n${truncate(text)}`;
	}

	if (entry?.customType) {
		const text = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content ?? "");
		return `### ${entry.customType}\n${truncate(text, MAX_TOOL_CHARS)}`;
	}

	return null;
}

function gitSnapshot(cwd: string): string {
	if (!existsSync(join(cwd, ".git")) && spawnSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).status !== 0) {
		return "Not inside a git worktree.";
	}

	const branch = spawnSync("git", ["-C", cwd, "branch", "--show-current"], { encoding: "utf8" }).stdout.trim();
	const head = spawnSync("git", ["-C", cwd, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
	const status = spawnSync("git", ["-C", cwd, "status", "--short"], { encoding: "utf8" }).stdout.trim();
	const upstream = spawnSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { encoding: "utf8" }).stdout.trim();
	return [
		`Branch: ${branch || "(detached)"}`,
		`HEAD: ${head || "unknown"}`,
		upstream ? `Upstream: ${upstream}` : undefined,
		"Status:",
		status || "clean",
	]
		.filter(Boolean)
		.join("\n");
}

function buildPrompt(ctx: ExtensionCommandContext, goal: string): string {
	const sessionFile = ctx.sessionManager.getSessionFile?.();
	const branch = ctx.sessionManager.getBranch?.() ?? [];
	const entries = (branch.length ? branch : ctx.sessionManager.getEntries?.() ?? []).slice(-MAX_RECENT_ENTRIES);
	const recent = entries.map(summarizeEntry).filter(Boolean).join("\n\n");
	const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";

	return `# Pi handoff\n\nYou are continuing work from another Pi session. Start by reading this handoff, then proceed toward the goal. If exact details are missing, inspect the parent session path or repository state rather than guessing.\n\n## Goal\n\n${goal || "Continue the previous task."}\n\n## Parent session\n\n- Path: ${sessionFile ?? "(ephemeral / unknown)"}\n- Working directory: ${ctx.cwd}\n- Model at handoff: ${model}\n- Generated: ${new Date().toISOString()}\n\n## Git snapshot\n\n\`\`\`\n${gitSnapshot(ctx.cwd)}\n\`\`\`\n\n## Recent conversation and tool results\n\n${recent || "No recent entries were available."}\n\n## Operating instructions\n\n- Continue in ${ctx.cwd}.\n- Prefer fresh inspection over assumptions.\n- Use the parent session path as provenance for missing context.\n- Preserve user intent from the handoff goal above.\n`;
}

function commandForPrompt(cwd: string, promptFile: string, goal: string): LaunchPlan {
	const title = `pi handoff: ${slugify(goal).slice(0, 28)}`;
	const piBin = resolvePiBin();
	const args = ["--name", title, `@${promptFile}`];
	const display = `cd ${shellQuote(cwd)} && ${shellQuote(piBin)} ${args.map(shellQuote).join(" ")}`;
	return { args, display, title, piBin, promptFile };
}

function renderTemplate(template: string, ctx: LaunchContext): string {
	const values: Record<string, string> = {
		cwd: ctx.cwd,
		title: ctx.title,
		display: ctx.display,
		pi: ctx.piBin,
		promptFile: ctx.promptFile,
	};
	return template.replace(/\{(cwd|title|display|pi|promptFile)\}/g, (_match, key: string) => shellQuote(values[key] ?? ""));
}

function launchCustomTemplate(ctx: LaunchContext): string | null {
	const template = process.env.PI_HANDOFF_COMMAND_TEMPLATE;
	if (!template?.trim()) return noteSkip(ctx, "custom template", "PI_HANDOFF_COMMAND_TEMPLATE is unset");
	const command = renderTemplate(template, ctx);
	if (runDiag(ctx, "custom template", "/bin/sh", ["-lc", command])) return "custom template";
	return null;
}

function launchZellijTab(ctx: LaunchContext): string | null {
	if (!process.env.ZELLIJ) return noteSkip(ctx, "zellij tab", "$ZELLIJ is unset");
	if (!hasCommand("zellij")) return noteSkip(ctx, "zellij tab", "zellij not found");
	if (runDiag(ctx, "zellij tab", "zellij", ["action", "new-tab", "--cwd", ctx.cwd, "--name", ctx.title, "--", ctx.piBin, ...ctx.args])) {
		return "zellij tab";
	}
	return null;
}

function launchZellijRun(ctx: LaunchContext): string | null {
	if (!process.env.ZELLIJ) return noteSkip(ctx, "zellij run", "$ZELLIJ is unset");
	if (!hasCommand("zellij")) return noteSkip(ctx, "zellij run", "zellij not found");
	if (runDiag(ctx, "zellij run", "zellij", ["run", "--cwd", ctx.cwd, "--name", ctx.title, "--", ctx.piBin, ...ctx.args])) return "zellij run pane";
	return null;
}

function launchTmux(ctx: LaunchContext): string | null {
	if (!process.env.TMUX) return noteSkip(ctx, "tmux", "$TMUX is unset");
	if (!hasCommand("tmux")) return noteSkip(ctx, "tmux", "tmux not found");
	if (runDiag(ctx, "tmux", "tmux", ["new-window", "-c", ctx.cwd, "-n", ctx.title, ctx.display])) return "tmux new-window";
	return null;
}

function launchWezTerm(ctx: LaunchContext): string | null {
	if (!process.env.WEZTERM_PANE) return noteSkip(ctx, "wezterm", "$WEZTERM_PANE is unset");
	if (!hasCommand("wezterm")) return noteSkip(ctx, "wezterm", "wezterm not found");
	if (runDiag(ctx, "wezterm", "wezterm", ["cli", "split-pane", "--cwd", ctx.cwd, "--right", "--percent", "50", "--", ctx.piBin, ...ctx.args])) {
		return "wezterm split-pane";
	}
	return null;
}

function launchKitty(ctx: LaunchContext): string | null {
	if (!process.env.KITTY_LISTEN_ON) return noteSkip(ctx, "kitty", "$KITTY_LISTEN_ON is unset");
	if (!hasCommand("kitty")) return noteSkip(ctx, "kitty", "kitty not found");
	if (runDiag(ctx, "kitty", "kitty", ["@", "launch", "--cwd", ctx.cwd, "--type", "tab", "--title", ctx.title, ctx.piBin, ...ctx.args])) return "kitty tab";
	return null;
}

function launchGhostty(ctx: LaunchContext): string | null {
	if (!hasCommand("ghostty")) return noteSkip(ctx, "ghostty", "ghostty not found");
	if (runDiag(ctx, "ghostty", "ghostty", ["--working-directory", ctx.cwd, "--title", ctx.title, "-e", "/bin/sh", "-lc", ctx.display])) {
		return "ghostty window";
	}
	return null;
}

function launchAlacritty(ctx: LaunchContext): string | null {
	if (!hasCommand("alacritty")) return noteSkip(ctx, "alacritty", "alacritty not found");
	if (runDiag(ctx, "alacritty", "alacritty", ["--working-directory", ctx.cwd, "--title", ctx.title, "-e", "/bin/sh", "-lc", ctx.display])) {
		return "alacritty window";
	}
	return null;
}

function launchITerm(ctx: LaunchContext): string | null {
	if (process.platform !== "darwin") return noteSkip(ctx, "iTerm", "not macOS");
	if (isSshSession()) return noteSkip(ctx, "iTerm", "SSH session");
	if (!hasCommand("osascript")) return noteSkip(ctx, "iTerm", "osascript not found");
	if (process.env.TERM_PROGRAM !== "iTerm.app") return noteSkip(ctx, "iTerm", "TERM_PROGRAM is not iTerm.app");
	const script = `tell application "iTerm"\n  activate\n  if (count of windows) = 0 then\n    create window with default profile command ${appleScriptQuote(ctx.display)}\n  else\n    tell current window\n      create tab with default profile command ${appleScriptQuote(ctx.display)}\n    end tell\n  end if\nend tell`;
	if (runDiag(ctx, "iTerm", "osascript", ["-e", script])) return "iTerm tab";
	return null;
}

function launchTerminalApp(ctx: LaunchContext): string | null {
	if (process.platform !== "darwin") return noteSkip(ctx, "Terminal.app", "not macOS");
	if (isSshSession()) return noteSkip(ctx, "Terminal.app", "SSH session");
	if (!hasCommand("osascript")) return noteSkip(ctx, "Terminal.app", "osascript not found");
	const allowed = process.env.TERM_PROGRAM === "Apple_Terminal" || process.env.PI_HANDOFF_ALLOW_TERMINAL_APP === "1";
	if (!allowed) return noteSkip(ctx, "Terminal.app", "not Apple Terminal; set PI_HANDOFF_ALLOW_TERMINAL_APP=1 to opt in");
	const script = `tell application "Terminal"\n  do script ${appleScriptQuote(ctx.display)}\n  activate\nend tell`;
	if (runDiag(ctx, "Terminal.app", "osascript", ["-e", script])) return "Terminal.app window";
	return null;
}

const LAUNCHER_ORDER = [
	"cmux",
	"zellij-tab",
	"zellij-run",
	"tmux-window",
	"wezterm-split",
	"kitty-tab",
	"ghostty-window",
	"alacritty-window",
	"iterm-tab",
	"terminal-app",
	"manual",
] as const;

type LauncherName = (typeof LAUNCHER_ORDER)[number];

const LAUNCHERS: Record<Exclude<LauncherName, "manual">, Launcher> = {
	cmux: launchCmux,
	"zellij-tab": launchZellijTab,
	"zellij-run": launchZellijRun,
	"tmux-window": launchTmux,
	"wezterm-split": launchWezTerm,
	"kitty-tab": launchKitty,
	"ghostty-window": launchGhostty,
	"alacritty-window": launchAlacritty,
	"iterm-tab": launchITerm,
	"terminal-app": launchTerminalApp,
};

function normalizeLauncherName(value: string): LauncherName | "custom" | undefined {
	const normalized = value.trim().toLowerCase();
	if (normalized === "zellij") return "zellij-tab";
	if (normalized === "tmux") return "tmux-window";
	if (normalized === "wezterm") return "wezterm-split";
	if (normalized === "kitty") return "kitty-tab";
	if (normalized === "ghostty") return "ghostty-window";
	if (normalized === "alacritty") return "alacritty-window";
	if (normalized === "iterm" || normalized === "iterm-window") return "iterm-tab";
	if (normalized === "terminal" || normalized === "terminal.app") return "terminal-app";
	if (normalized === "custom") return "custom";
	return LAUNCHER_ORDER.includes(normalized as LauncherName) ? (normalized as LauncherName) : undefined;
}

async function tryLauncher(ctx: LaunchContext, name: LauncherName | "custom"): Promise<string | null> {
	if (name === "manual") return null;
	if (name === "custom") return launchCustomTemplate(ctx);
	return await LAUNCHERS[name](ctx);
}

async function launch(ctx: LaunchContext): Promise<string | null> {
	const override = process.env.PI_HANDOFF_LAUNCHER;
	if (override?.trim()) {
		const selected = normalizeLauncherName(override);
		if (!selected) {
			ctx.diagnostics.push(`override skipped: unknown PI_HANDOFF_LAUNCHER=${override}`);
		} else if (selected === "manual") {
			ctx.diagnostics.push("manual selected by PI_HANDOFF_LAUNCHER");
			return null;
		} else {
			const launched = await tryLauncher(ctx, selected);
			if (launched) return launched;
			ctx.diagnostics.push(`override ${selected} did not launch; not falling through automatically`);
			return null;
		}
	}

	if (process.env.PI_HANDOFF_COMMAND_TEMPLATE?.trim()) {
		const custom = launchCustomTemplate(ctx);
		if (custom) return custom;
	}

	for (const name of LAUNCHER_ORDER) {
		const launched = await tryLauncher(ctx, name);
		if (launched) return launched;
	}

	return null;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("handoff", {
		description: "Continue this Pi session in a fresh terminal/mux pane. Usage: /handoff <goal>",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const goal = args?.trim() || "Continue the current task.";
			const dir = join(homedir(), ".pi", "agent", "handoffs");
			mkdirSync(dir, { recursive: true });

			const promptFile = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(goal)}.md`);
			writeFileSync(promptFile, buildPrompt(ctx, goal), "utf8");

			const plan = commandForPrompt(ctx.cwd, promptFile, goal);
			const launchCtx: LaunchContext = { pi, cwd: ctx.cwd, diagnostics: [], ...plan };
			const launched = await launch(launchCtx);

			if (launched) {
				ctx.ui.notify(`Handoff opened via ${launched}.\nPrompt: ${promptFile}`, "info");
				return;
			}

			const diagnostics = launchCtx.diagnostics.length ? `\n\nTried:\n- ${launchCtx.diagnostics.join("\n- ")}` : "";
			ctx.ui.notify(`No supported terminal launcher detected. Run this manually:\n${plan.display}\n\nPrompt: ${promptFile}${diagnostics}`, "warning");
		},
	});
}
