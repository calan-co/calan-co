import assert from "node:assert/strict";
import test from "node:test";
import autonameExtension, {
	buildConversationText,
	deterministicFallback,
	extractFirstUserText,
	extractRecentUserText,
	loadConfigFromEnv,
	sanitizeTitle,
} from "../extensions/pi-autoname/index.ts";

const entries = [
	{ type: "message", message: { role: "user", content: [{ type: "text", text: "check online resources for a Pi autoname extension" }] } },
	{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "I found a Kimchi session-name extension." }] } },
	{ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "ignored" }] } },
];

test("pi-autoname loads config from env", () => {
	const config = loadConfigFromEnv({
		PI_AUTONAME_DISABLE_AUTO: "1",
		PI_AUTONAME_MODE: "once",
		PI_AUTONAME_PROVIDER: "anthropic",
		PI_AUTONAME_MODEL: "claude-test",
		PI_AUTONAME_MAX_TITLE_LENGTH: "32",
		PI_AUTONAME_MAX_TRANSCRIPT_CHARS: "1200",
		PI_AUTONAME_MIN_TURNS_BETWEEN_UPDATES: "5",
		PI_AUTONAME_FALLBACK_ONLY: "1",
	});
	assert.equal(config.auto, false);
	assert.equal(config.mode, "once");
	assert.equal(config.provider, "anthropic");
	assert.equal(config.model, "claude-test");
	assert.equal(config.maxTitleLength, 32);
	assert.equal(config.maxTranscriptChars, 1200);
	assert.equal(config.minTurnsBetweenUpdates, 5);
	assert.equal(config.fallbackOnly, true);
	assert.equal(config.useVcc, true);
});

test("pi-autoname extracts and formats transcript text", () => {
	assert.equal(extractFirstUserText(entries), "check online resources for a Pi autoname extension");
	assert.equal(extractRecentUserText(entries), "check online resources for a Pi autoname extension");
	assert.match(buildConversationText(entries), /User: check online resources/);
	assert.match(buildConversationText(entries), /Assistant: I found a Kimchi/);
	assert.doesNotMatch(buildConversationText(entries), /ignored/);
});

test("pi-autoname uses recent user text for fallback titles", () => {
	const longEntries = [
		...entries,
		{ type: "message", message: { role: "user", content: [{ type: "text", text: "now make the autoname extension summarize the entire thread with pi-vcc" }] } },
	];
	assert.equal(extractRecentUserText(longEntries, 1), "now make the autoname extension summarize the entire thread with pi-vcc");
});

test("pi-autoname sanitizes and truncates titles", () => {
	assert.equal(sanitizeTitle('## Title: "Implement Autoname Extension."', 80), "Implement Autoname Extension");
	assert.equal(deterministicFallback("   ", "/tmp/my-project", 80), "my-project");
	assert.equal(deterministicFallback("Implement a dynamically refreshed session naming extension", "/tmp/x", 24), "Implement a dynamically");
});

test("pi-autoname registers /name refresh and auto subcommands", async () => {
	const events = new Map();
	const commands = new Map();
	let sessionName = "";
	const notifications = [];
	const pi = {
		on: (name, handler) => events.set(name, handler),
		registerCommand: (name, definition) => commands.set(name, definition),
		setSessionName: (name) => {
			sessionName = name;
		},
		getSessionName: () => sessionName,
	};
	autonameExtension(pi);
	const command = commands.get("name");
	const autonameCommand = commands.get("autoname");
	assert.ok(command);
	assert.ok(autonameCommand);

	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		ui: { notify: (message, level) => notifications.push({ message, level }) },
		modelRegistry: {},
		sessionManager: {
			getBranch: () => entries,
			getEntries: () => entries,
			getSessionName: () => sessionName,
		},
	};

	await autonameCommand.handler("refresh", ctx);
	assert.equal(sessionName, "check online resources for a Pi");
	assert.ok(notifications.some((entry) => entry.message.includes("Session named")));

	sessionName = "refresh";
	await events.get("input")({ text: "/name refresh", source: "interactive" }, ctx);
	assert.equal(sessionName, "check online resources for a Pi");

	await command.handler("auto off", ctx);
	assert.ok(notifications.some((entry) => entry.message === "Autoname disabled"));

	await command.handler("Manual Name", ctx);
	assert.equal(sessionName, "Manual Name");
});
