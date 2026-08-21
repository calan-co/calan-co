import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import rewindExtension, { ignorePatternsForConfig, loadConfigFromEnv } from "../extensions/pi-rewind/index.ts";

test("pi-rewind config defaults to safe mode with hard and safe excludes", () => {
	const config = loadConfigFromEnv({});
	assert.equal(config.mode, "safe");
	assert.equal(config.autoCheckpoint, true);
	const ignores = ignorePatternsForConfig(config);
	assert.ok(ignores.includes(".pi/pi-rewind/"));
	assert.ok(ignores.includes(".git/"));
	assert.ok(ignores.includes("node_modules/"));
	assert.ok(ignores.includes(".env"));
});

test("pi-rewind custom mode adds user Git-ignore-style patterns", () => {
	const config = loadConfigFromEnv({ PI_REWIND_MODE: "custom", PI_REWIND_IGNORE: "dist/:cache/\n.env.local" });
	assert.equal(config.mode, "custom");
	const ignores = ignorePatternsForConfig(config);
	assert.ok(ignores.includes(".pi/pi-rewind/"));
	assert.ok(!ignores.includes("node_modules/"));
	assert.ok(ignores.includes("dist/"));
	assert.ok(ignores.includes("cache/"));
	assert.ok(ignores.includes(".env.local"));
});

test("pi-rewind can checkpoint and restore workspace content by entry id", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-rewind-test-"));
	const events = new Map();
	const commands = new Map();
	const pi = {
		on: (name, handler) => events.set(name, handler),
		registerCommand: (name, definition) => commands.set(name, definition),
	};
	rewindExtension(pi);

	let leaf = "entry1";
	const notifications = [];
	const ctx = {
		cwd,
		hasUI: true,
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			select: async (_title, options) => options[0],
		},
		sessionManager: {
			getSessionFile: () => join(cwd, "session.jsonl"),
			getLeafId: () => leaf,
			getLeafEntry: () => ({ id: leaf }),
		},
	};

	await writeFile(join(cwd, "a.txt"), "one\n");
	await events.get("session_start")({}, ctx);

	leaf = "entry2";
	await events.get("before_agent_start")({}, ctx);
	await writeFile(join(cwd, "a.txt"), "two\n");
	await events.get("agent_end")({}, ctx);

	const rewind = commands.get("rewind");
	assert.ok(rewind);

	await rewind.handler("restore entry2", ctx);
	assert.equal(await readFile(join(cwd, "a.txt"), "utf8"), "two\n");

	await rewind.handler("restore entry1", ctx);
	assert.equal(await readFile(join(cwd, "a.txt"), "utf8"), "one\n");
	assert.ok(notifications.some((entry) => entry.message.includes("restored workspace")));
});
