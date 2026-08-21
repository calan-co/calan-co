/**
 * Pi Autoname
 *
 * Auto-generates and refreshes Pi session names from the transcript.
 */

import { basename } from "node:path";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface AutonameConfig {
	auto: boolean;
	mode: "once" | "dynamic";
	provider: string;
	model: string;
	maxTitleLength: number;
	maxTranscriptChars: number;
	minTurnsBetweenUpdates: number;
	fallbackOnly: boolean;
	useVcc: boolean;
}

type ContentBlock = {
	type?: string;
	text?: string;
};

type SessionEntry = {
	type?: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

interface RuntimeState {
	auto: boolean;
	extensionOwnedName: string | null;
	settingName: boolean;
	turnsSinceUpdate: number;
	hasAttemptedInitialName: boolean;
}

const DEFAULT_PROVIDER = "openai";
const DEFAULT_MODEL = "gpt-5.2";
const DEFAULT_MAX_TITLE_LENGTH = 36;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 12000;
const DEFAULT_MIN_TURNS_BETWEEN_UPDATES = 3;

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AutonameConfig {
	const mode = env.PI_AUTONAME_MODE === "once" ? "once" : "dynamic";
	return {
		auto: env.PI_AUTONAME_DISABLE_AUTO !== "1",
		mode,
		provider: env.PI_AUTONAME_PROVIDER || DEFAULT_PROVIDER,
		model: env.PI_AUTONAME_MODEL || DEFAULT_MODEL,
		maxTitleLength: parsePositiveInt(env.PI_AUTONAME_MAX_TITLE_LENGTH, DEFAULT_MAX_TITLE_LENGTH),
		maxTranscriptChars: parsePositiveInt(env.PI_AUTONAME_MAX_TRANSCRIPT_CHARS, DEFAULT_MAX_TRANSCRIPT_CHARS),
		minTurnsBetweenUpdates: parsePositiveInt(env.PI_AUTONAME_MIN_TURNS_BETWEEN_UPDATES, DEFAULT_MIN_TURNS_BETWEEN_UPDATES),
		fallbackOnly: env.PI_AUTONAME_FALLBACK_ONLY === "1",
		useVcc: env.PI_AUTONAME_DISABLE_VCC !== "1",
	};
}

function extractTextParts(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];

	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as ContentBlock;
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts;
}

function entriesFromContext(ctx: ExtensionContext | ExtensionCommandContext): SessionEntry[] {
	const branch = ctx.sessionManager.getBranch?.();
	if (Array.isArray(branch) && branch.length > 0) return branch as SessionEntry[];
	const entries = ctx.sessionManager.getEntries?.();
	return Array.isArray(entries) ? (entries as SessionEntry[]) : [];
}

export function extractFirstUserText(entries: SessionEntry[]): string | null {
	const texts: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const text = extractTextParts(entry.message.content).join("\n").trim();
		if (text) texts.push(text);
		if (texts.length >= 3) break;
	}
	return texts.length > 0 ? texts.join("\n---\n") : null;
}

export function extractRecentUserText(entries: SessionEntry[], count = 4): string | null {
	const texts: string[] = [];
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const text = extractTextParts(entry.message.content).join("\n").trim();
		if (text) texts.push(text);
		if (texts.length >= count) break;
	}
	return texts.length > 0 ? texts.reverse().join("\n---\n") : null;
}

export function buildConversationText(entries: SessionEntry[], maxChars = DEFAULT_MAX_TRANSCRIPT_CHARS): string {
	const sections: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const role = entry.message?.role;
		if (role !== "user" && role !== "assistant") continue;
		const text = extractTextParts(entry.message.content).join("\n").trim();
		if (!text) continue;
		sections.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
	}

	const full = sections.join("\n\n").trim();
	if (full.length <= maxChars) return full;
	return `...\n${full.slice(-maxChars).trimStart()}`;
}

export function sanitizeTitle(input: string, maxLength = DEFAULT_MAX_TITLE_LENGTH): string {
	let title = input
		.trim()
		.split(/\r?\n/)[0]
		.replace(/^#+\s*/, "")
		.replace(/^[-*]\s*/, "")
		.replace(/^Title:\s*/i, "")
		.replace(/["'`]/g, "")
		.replace(/\s+/g, " ")
		.trim();

	if (title.length > maxLength) {
		const truncated = title.slice(0, maxLength);
		const lastSpace = truncated.lastIndexOf(" ");
		title = (lastSpace > Math.floor(maxLength * 0.5) ? truncated.slice(0, lastSpace) : truncated).trim();
	}

	return title.replace(/[.,;:!?\-–—]+$/g, "").trim();
}

export function deterministicFallback(input: string, cwd = process.cwd(), maxLength = DEFAULT_MAX_TITLE_LENGTH): string {
	const sanitized = sanitizeTitle(input, maxLength);
	if (sanitized) return sanitized;
	return sanitizeTitle(basename(cwd), maxLength) || "Pi Session";
}

function titlePrompt(conversationText: string): string {
	return [
		"Generate a concise session title for this Pi coding-agent transcript.",
		"Rules:",
		"- 2 to 5 words, maximum 36 characters.",
		"- No quotes, markdown, trailing punctuation, or explanation.",
		"- Prefer the CURRENT/RECENT task over old setup work.",
		"- Capture the actual topic, not generic words like conversation/session/chat.",
		"",
		"Transcript or structured summary:",
		conversationText,
	].join("\n");
}

function entryToMessage(entry: SessionEntry): any | null {
	const role = entry.message?.role;
	if (role !== "user" && role !== "assistant") return null;
	const text = extractTextParts(entry.message.content).join("\n").trim();
	if (!text) return null;
	return {
		role,
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

async function buildVccSummary(entries: SessionEntry[], config: AutonameConfig): Promise<string | null> {
	if (!config.useVcc) return null;
	try {
		const mod: any = await import("@sting8k/pi-vcc/src/core/summarize.ts");
		const compileRanked = mod.compileRanked ?? mod.default?.compileRanked;
		if (typeof compileRanked !== "function") return null;
		const messages = entries.map(entryToMessage).filter(Boolean);
		if (messages.length === 0) return null;
		const summary = compileRanked({ messages });
		return typeof summary === "string" && summary.trim() ? summary.trim() : null;
	} catch {
		return null;
	}
}

async function completeTitleWithPiAi(
	ctx: ExtensionContext | ExtensionCommandContext,
	config: AutonameConfig,
	conversationText: string,
): Promise<string | null> {
	if (config.fallbackOnly) return null;

	let compat: any;
	try {
		compat = await import("@earendil-works/pi-ai/compat");
	} catch {
		return null;
	}

	const model = compat.getModel?.(config.provider, config.model);
	if (!model || !ctx.modelRegistry?.getApiKeyAndHeaders) return null;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth?.ok || !auth.apiKey) return null;

	const response = await compat.complete(
		model,
		{
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: titlePrompt(conversationText) }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			reasoningEffort: "minimal",
		},
	);

	return response.content
		?.filter((part: any) => part?.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("\n")
		.trim() || null;
}

export async function suggestSessionName(
	ctx: ExtensionContext | ExtensionCommandContext,
	config: AutonameConfig = loadConfigFromEnv(),
): Promise<string> {
	const entries = entriesFromContext(ctx);
	const transcriptTail = buildConversationText(entries, config.maxTranscriptChars);
	const recentUser = extractRecentUserText(entries);
	const fallback = deterministicFallback(recentUser ?? transcriptTail, ctx.cwd, config.maxTitleLength);

	if (!transcriptTail) return fallback;

	const vccSummary = await buildVccSummary(entries, config);
	const titleSource = vccSummary
		? [
			"Structured whole-thread summary from pi-vcc:",
			vccSummary,
			"",
			"Recent user turns, highest priority:",
			recentUser ?? "(none)",
		].join("\n")
		: [
			"Recent user turns, highest priority:",
			recentUser ?? "(none)",
			"",
			"Transcript tail:",
			transcriptTail,
		].join("\n");

	try {
		const generated = await completeTitleWithPiAi(ctx, config, titleSource);
		return generated ? deterministicFallback(generated, ctx.cwd, config.maxTitleLength) : fallback;
	} catch {
		return fallback;
	}
}

function setName(pi: ExtensionAPI, state: RuntimeState, name: string, owner: "extension" | "manual" = "extension") {
	state.settingName = true;
	try {
		pi.setSessionName(name);
		state.extensionOwnedName = owner === "extension" ? name : null;
	} finally {
		state.settingName = false;
	}
}

function currentName(pi: ExtensionAPI, ctx: ExtensionContext | ExtensionCommandContext): string | undefined {
	return pi.getSessionName?.() || ctx.sessionManager.getSessionName?.();
}

async function refreshName(pi: ExtensionAPI, ctx: ExtensionContext | ExtensionCommandContext, config: AutonameConfig, state: RuntimeState, notify = true) {
	const suggestion = await suggestSessionName(ctx, config);
	if (!suggestion) {
		if (notify && ctx.hasUI) ctx.ui.notify("Could not generate a session name", "warning");
		return;
	}
	setName(pi, state, suggestion);
	state.turnsSinceUpdate = 0;
	state.hasAttemptedInitialName = true;
	if (notify && ctx.hasUI) ctx.ui.notify(`Session named: ${suggestion}`, "info");
}

function commandCompletions(prefix: string): AutocompleteItem[] | null {
	const items = [
		{ value: "refresh", label: "refresh", description: "Regenerate the session name from transcript" },
		{ value: "auto status", label: "auto status", description: "Show autoname status" },
		{ value: "auto on", label: "auto on", description: "Enable automatic dynamic naming" },
		{ value: "auto off", label: "auto off", description: "Disable automatic dynamic naming" },
	];
	const filtered = items.filter((item) => item.value.startsWith(prefix));
	return filtered.length > 0 ? filtered : null;
}

async function handleNameArgs(
	args: string,
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext | ExtensionContext,
	config: AutonameConfig,
	state: RuntimeState,
): Promise<boolean> {
	const trimmed = args.trim();
	if (!trimmed) {
		const name = currentName(pi, ctx);
		if (ctx.hasUI) ctx.ui.notify(name ? `Session: ${name}` : "No session name set. Try /autoname refresh.", "info");
		return true;
	}

	if (trimmed === "refresh") {
		await refreshName(pi, ctx, config, state, true);
		return true;
	}

	if (trimmed === "auto status") {
		const owner = state.extensionOwnedName ? `extension-owned: ${state.extensionOwnedName}` : "not extension-owned";
		if (ctx.hasUI) ctx.ui.notify(`Autoname is ${state.auto ? "on" : "off"}; mode=${config.mode}; ${owner}`, "info");
		return true;
	}

	if (trimmed === "auto on") {
		state.auto = true;
		if (ctx.hasUI) ctx.ui.notify("Autoname enabled", "info");
		return true;
	}

	if (trimmed === "auto off") {
		state.auto = false;
		if (ctx.hasUI) ctx.ui.notify("Autoname disabled", "info");
		return true;
	}

	return false;
}

export default function autonameExtension(pi: ExtensionAPI) {
	const config = loadConfigFromEnv();
	const state: RuntimeState = {
		auto: config.auto,
		extensionOwnedName: null,
		settingName: false,
		turnsSinceUpdate: 0,
		hasAttemptedInitialName: false,
	};

	pi.on("session_info_changed", async (event: any) => {
		if (state.settingName) return;
		const name = event?.name;
		if (name && name !== state.extensionOwnedName) {
			state.extensionOwnedName = null;
		}
	});

	pi.on("turn_end", async (_event: any, ctx: ExtensionContext) => {
		if (!state.auto) return;
		state.turnsSinceUpdate += 1;

		const name = currentName(pi, ctx);
		if (!name) {
			if (state.hasAttemptedInitialName) return;
			await refreshName(pi, ctx, config, state, false);
			return;
		}

		if (config.mode !== "dynamic") return;
		if (name !== state.extensionOwnedName) return;
		if (state.turnsSinceUpdate < config.minTurnsBetweenUpdates) return;
		await refreshName(pi, ctx, config, state, false);
	});

	pi.on("input", async (event: any, ctx: ExtensionContext) => {
		if (event.source === "extension") return { action: "continue" };
		const text = typeof event.text === "string" ? event.text.trim() : "";
		const match = text.match(/^\/name\s+(refresh|auto(?:\s+(?:on|off|status))?)$/);
		if (!match) return { action: "continue" };
		await handleNameArgs(match[1], pi, ctx, config, state);
		return { action: "handled" };
	});

	pi.registerCommand("autoname", {
		description: "Auto-generate Pi session names; subcommands: refresh, auto on|off|status",
		getArgumentCompletions: commandCompletions,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const handled = await handleNameArgs(args, pi, ctx, config, state);
			if (!handled && ctx.hasUI) ctx.ui.notify("Usage: /autoname refresh | auto on | auto off | auto status", "warning");
		},
	});

	pi.registerCommand("name", {
		description: "Set/show session name; subcommands: refresh, auto on|off|status",
		getArgumentCompletions: commandCompletions,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const handled = await handleNameArgs(args, pi, ctx, config, state);
			if (handled) return;
			setName(pi, state, args.trim(), "manual");
			ctx.ui.notify(`Session named: ${args.trim()}`, "info");
		},
	});
}
