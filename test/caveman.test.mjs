import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const modes = await import("../modes.js");
const config = await import("../config.js");
const skill = await import("../skill.js");
const ext = await import("../index.js");
const { DEFAULT_MODE } = await import("../constants.js");

// ── normalizeMode / normalizeConfigMode / normalizePersistedMode ───────
test("normalizeMode: trims, lowercases, accepts off/lite/full/ultra only", () => {
	assert.equal(modes.normalizeMode("  FULL "), "full");
	assert.equal(modes.normalizeMode("Lite"), "lite");
	assert.equal(modes.normalizeMode("off"), "off");
	assert.equal(modes.normalizeMode("ultra"), "ultra");
	assert.equal(modes.normalizeMode("commit"), null, "independent modes are not session modes");
	assert.equal(modes.normalizeMode("zzz"), null);
	assert.equal(modes.normalizeMode(""), null);
	assert.equal(modes.normalizeMode(null), null);
	assert.equal(modes.normalizeMode(42), null);
});

test("normalizeConfigMode: adds commit/review/compress", () => {
	assert.equal(modes.normalizeConfigMode("Commit"), "commit");
	assert.equal(modes.normalizeConfigMode("review"), "review");
	assert.equal(modes.normalizeConfigMode("compress"), "compress");
	assert.equal(modes.normalizeConfigMode("full"), "full");
	assert.equal(modes.normalizeConfigMode("nope"), null);
});

test("normalizePersistedMode: session modes + config modes", () => {
	assert.equal(modes.normalizePersistedMode("ultra"), "ultra");
	assert.equal(modes.normalizePersistedMode("REVIEW"), "review");
	assert.equal(modes.normalizePersistedMode("bogus"), null);
});

// ── resolveSessionMode ──────────────────────────────────────────────────
test("resolveSessionMode: scans backwards for last caveman-mode entry", () => {
	const entries = [
		{ type: "custom", customType: "caveman-mode", data: { mode: "lite" } },
		{ type: "custom", customType: "other", data: { mode: "ultra" } },
		{ type: "custom", customType: "caveman-mode", data: { mode: "ultra" } },
	];
	assert.equal(modes.resolveSessionMode(entries), "ultra");
});

test("resolveSessionMode: skips invalid modes, non-array falls back", () => {
	const entries = [
		{ type: "custom", customType: "caveman-mode", data: { mode: "zzz" } },
		{ type: "custom", customType: "caveman-mode", data: { mode: "lite" } },
	];
	assert.equal(modes.resolveSessionMode(entries), "lite");
	assert.equal(modes.resolveSessionMode("not-array", "off"), "off");
	assert.equal(modes.resolveSessionMode([]), DEFAULT_MODE);
});

// ── parseCavemanCommand ─────────────────────────────────────────────────
test("parseCavemanCommand: empty and status", () => {
	assert.deepEqual(modes.parseCavemanCommand(""), { type: "status" });
	assert.deepEqual(modes.parseCavemanCommand("  "), { type: "status" });
	assert.deepEqual(modes.parseCavemanCommand("status"), { type: "status" });
});

test("parseCavemanCommand: default subcommand", () => {
	assert.deepEqual(modes.parseCavemanCommand("default ultra"), { type: "set-default", mode: "ultra" });
	assert.deepEqual(modes.parseCavemanCommand("default"), { type: "invalid", reason: "invalid-default-mode" });
	assert.deepEqual(modes.parseCavemanCommand("default zzz"), { type: "invalid", reason: "invalid-default-mode" });
	assert.deepEqual(modes.parseCavemanCommand("default review"), { type: "set-default", mode: "review" });
});

test("parseCavemanCommand: set-mode + invalid", () => {
	assert.deepEqual(modes.parseCavemanCommand("ultra"), { type: "set-mode", mode: "ultra" });
	assert.deepEqual(modes.parseCavemanCommand("ULTRA extra ignored"), { type: "set-mode", mode: "ultra" });
	const bad = modes.parseCavemanCommand("loud");
	assert.equal(bad.type, "invalid");
	assert.equal(bad.reason, "invalid-mode");
	assert.equal(bad.mode, "loud");
});

// ── filterSkillBodyForMode ──────────────────────────────────────────────
const SKILL_FIXTURE = `---
name: caveman
description: yadda
---

Respond terse like smart caveman.

| **full** | Full caveman |
| **lite** | Lite caveman |
| **ultra** | Ultra caveman |

## Rules

- full: drop articles
- lite: keep articles
Always: code normal
`;

test("filterSkillBodyForMode: strips frontmatter, keeps only active mode rows", () => {
	const out = modes.filterSkillBodyForMode(SKILL_FIXTURE, "lite");
	assert.equal(out.includes("name: caveman"), false);
	assert.equal(out.includes("**full**"), false);
	assert.equal(out.includes("**lite**"), true);
	assert.equal(out.includes("drop articles"), false);
	assert.equal(out.includes("keep articles"), true);
	assert.equal(out.includes("code normal"), true, "non-mode lines preserved");
});

test("filterSkillBodyForMode: invalid mode falls back to full, null body handled", () => {
	const out = modes.filterSkillBodyForMode(SKILL_FIXTURE, "bogus");
	assert.equal(out.includes("**lite**"), false);
	assert.equal(out.includes("**full**"), true);
	assert.equal(modes.filterSkillBodyForMode(null, "full"), "");
});

// ── getCavemanInstructions ──────────────────────────────────────────────
test("getCavemanInstructions: session modes read real SKILL.md, header carries level", () => {
	const out = skill.getCavemanInstructions("ultra");
	assert.match(out, /CAVEMAN MODE ACTIVE — level: ultra/);
	assert.match(out, /Abbreviate prose words/, "real SKILL.md ultra row present");
});

test("getCavemanInstructions: independent modes point at their skill", () => {
	for (const [mode, cmd] of [["commit", "/caveman-commit"], ["review", "/caveman-review"], ["compress", "/caveman:compress"]]) {
		const out = skill.getCavemanInstructions(mode);
		assert.match(out, new RegExp(`level: ${mode}`));
		assert.match(out, new RegExp(`Behavior defined by ${cmd.replace("/", "\\/")}`));
	}
});

test("getCavemanInstructions: off stays off as level (guard is the hook's job)", () => {
	const out = skill.getCavemanInstructions("off");
	assert.match(out, /level: off/);
});

// ── config (hermetic via configPath) ────────────────────────────────────
test("getConfigPath precedence: string arg > options.configPath > XDG > platform default", () => {
	assert.equal(config.getConfigPath("/tmp/x.json"), "/tmp/x.json");
	assert.equal(config.getConfigPath({ configPath: "/tmp/y.json" }), "/tmp/y.json");
	const savedXdg = process.env.XDG_CONFIG_HOME;
	try {
		process.env.XDG_CONFIG_HOME = "/xdg-root";
		assert.equal(config.getConfigPath(), join("/xdg-root", "caveman", "config.json"));
	} finally {
		if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = savedXdg;
	}
});

test("readDefaultMode: env override wins, then file, then DEFAULT_MODE", () => {
	const dir = mkdtempSync(join(tmpdir(), "cave-cfg-"));
	const path = join(dir, "config.json");
	const savedEnv = process.env.CAVEMAN_DEFAULT_MODE;

	writeFileSync(path, JSON.stringify({ defaultMode: "lite" }));
	assert.equal(config.readDefaultMode({ configPath: path }), "lite");

	try {
		process.env.CAVEMAN_DEFAULT_MODE = "ultra";
		assert.equal(config.readDefaultMode({ configPath: path }), "ultra", "env beats file");
	} finally {
		if (savedEnv === undefined) delete process.env.CAVEMAN_DEFAULT_MODE;
		else process.env.CAVEMAN_DEFAULT_MODE = savedEnv;
	}

	writeFileSync(path, "{ broken json");
	assert.equal(config.readDefaultMode({ configPath: path }), DEFAULT_MODE, "malformed file ignored");
	assert.equal(config.readDefaultMode({ configPath: join(dir, "missing.json") }), DEFAULT_MODE);

	rmSync(dir, { recursive: true, force: true });
});

test("writeDefaultMode: writes normalized JSON, rejects invalid, mkdir recursive", () => {
	const dir = join(mkdtempSync(join(tmpdir(), "cave-w-")), "deep", "nested");
	const path = join(dir, "config.json");
	assert.equal(config.writeDefaultMode("ULTRA", { configPath: path }), "ultra");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { defaultMode: "ultra" });
	assert.equal(config.writeDefaultMode("commit", { configPath: path }), "commit");
	assert.equal(config.writeDefaultMode("zzz", { configPath: path }), null);
	assert.equal(config.writeDefaultMode("", { configPath: path }), null);
});

// ── extension closure via fake pi ───────────────────────────────────────
function harness(entries = []) {
	const handlers = new Map();
	const commands = new Map();
	const notifies = [];
	const sent = [];
	const appended = [];
	const fakePi = {
		on: (ev, fn) => handlers.set(ev, fn),
		registerCommand: (name, def) => commands.set(name, def),
		appendEntry: (type, data) => appended.push({ type, data }),
		sendUserMessage: (msg, opts) => sent.push({ msg, opts }),
	};
	const ctx = {
		ui: { notify: (text, level) => notifies.push({ text, level }) },
		isIdle: () => true,
		sessionManager: { getBranch: () => entries },
	};
	ext.default(fakePi);
	return { handlers, commands, notifies, sent, appended, ctx };
}

test("registers /caveman + 4 alias commands + input/session_start/before_agent_start/context hooks", () => {
	const { handlers, commands } = harness();
	for (const c of ["caveman", "caveman-commit", "caveman-review", "caveman-help", "caveman:compress"]) {
		assert.ok(commands.has(c), c);
	}
	for (const h of ["input", "session_start", "before_agent_start", "context"]) {
		assert.ok(handlers.has(h), h);
	}
});

test("/caveman ultra: appends persisted entry + notifies; /caveman status reports", async () => {
	const { commands, notifies, appended, ctx } = harness();
	await commands.get("caveman").handler("ultra", ctx);
	assert.deepEqual(appended[0], { type: "caveman-mode", data: { mode: "ultra" } });
	assert.match(notifies[0].text, /Caveman mode set to ultra/);
	await commands.get("caveman").handler("status", ctx);
	assert.match(notifies[1].text, /current ultra/);
});

test("/caveman invalid notifies warning, no entry", async () => {
	const { commands, notifies, appended, ctx } = harness();
	await commands.get("caveman").handler("loud", ctx);
	assert.match(notifies[0].text, /Unknown or unsupported/);
	assert.equal(appended.length, 0);
});

test("/caveman default lite persists config and re-reads; env override reports conflict", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cave-ext-"));
	const path = join(dir, "config.json");
	const savedEnv = process.env.CAVEMAN_DEFAULT_MODE;
	delete process.env.CAVEMAN_DEFAULT_MODE;
	const savedConfigPath = config.getConfigPath;
	// point module at temp file via env-free seam: monkeypatch not possible on
	// const binding — use CAVEMAN_DEFAULT_MODE + XDG instead.
	const savedXdg = process.env.XDG_CONFIG_HOME;
	try {
		process.env.XDG_CONFIG_HOME = dir;
		const { commands, notifies, ctx } = harness();
		await commands.get("caveman").handler("default lite", ctx);
		assert.equal(JSON.parse(readFileSync(join(dir, "caveman", "config.json"), "utf8")).defaultMode, "lite");
		assert.match(notifies[0].text, /Default Caveman mode set to lite/);

		process.env.CAVEMAN_DEFAULT_MODE = "ultra";
		await commands.get("caveman").handler("default lite", ctx);
		assert.match(notifies[1].text, /env override keeps default at ultra/);
	} finally {
		if (savedEnv === undefined) delete process.env.CAVEMAN_DEFAULT_MODE;
		else process.env.CAVEMAN_DEFAULT_MODE = savedEnv;
		if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = savedXdg;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("alias commands: idle → direct send; busy → followUp + notify", async () => {
	const { commands, notifies, sent, ctx } = harness();
	await commands.get("caveman-commit").handler("", ctx);
	assert.deepEqual(sent[0], { msg: "/skill:caveman-commit", opts: undefined });

	ctx.isIdle = () => false;
	await commands.get("caveman:compress").handler("this doc", ctx);
	assert.deepEqual(sent[1], { msg: "/skill:caveman-compress this doc", opts: { deliverAs: "followUp" } });
	assert.match(notifies[0].text, /queued as follow-up/);
});

test("input hook: 'stop caveman' switches off + persists; extension-sourced input ignored", async () => {
	const { handlers, appended, ctx } = harness();
	const input = handlers.get("input");
	await input({ text: "ok stop caveman now" }, ctx);
	assert.deepEqual(appended[0], { type: "caveman-mode", data: { mode: "off" } });

	const before = appended.length;
	await input({ text: "normal mode", source: "extension" }, ctx);
	assert.equal(appended.length, before, "extension-sourced not processed");
});

test("session_start: restores mode from branch entries + refreshes default", async () => {
	const entries = [{ type: "custom", customType: "caveman-mode", data: { mode: "lite" } }];
	const { handlers, ctx } = harness(entries);
	const bs = handlers.get("before_agent_start");
	// before restore, mode = DEFAULT full → injection present
	assert.ok((await bs({ systemPrompt: "base" })) !== undefined);
	await handlers.get("session_start")({}, ctx);
	// after restore, currentMode = lite → injection still present but level lite
	const out = await bs({ systemPrompt: "base" });
	assert.match(out.systemPrompt, /level: lite/);
});

test("before_agent_start: off → undefined; on → system prompt + instructions", async () => {
	const { handlers, commands, ctx } = harness();
	const bs = handlers.get("before_agent_start");
	await handlers.get("input")({ text: "stop caveman" }, { ui: {} });
	assert.equal(await bs({ systemPrompt: "base" }), undefined);
	await commands.get("caveman").handler("full", ctx);
	const out = await bs({ systemPrompt: "base" });
	assert.ok(out.systemPrompt.startsWith("base"));
	assert.match(out.systemPrompt, /CAVEMAN MODE ACTIVE — level: full/);
});

test("context: off → undefined; on → hidden user reminder appended; dedup when last already reminder", async () => {
	const { handlers, commands, ctx } = harness();
	const cx = handlers.get("context");
	await handlers.get("input")({ text: "stop caveman" }, { ui: {} });
	assert.equal(await cx({ messages: [{ role: "user", content: "hi" }] }), undefined);

	await commands.get("caveman").handler("ultra", ctx);
	const msgs = [{ role: "user", content: "hi" }];
	let out = await cx({ messages: msgs });
	assert.equal(out.messages.length, 2);
	assert.equal(out.messages[1].role, "user");
	assert.match(out.messages[1].content[0].text, /CAVEMAN MODE ACTIVE/);
	assert.equal(out.messages[0], msgs[0], "originals untouched");

	const withReminder = [
		{ role: "user", content: "hi" },
		{ role: "user", content: [{ type: "text", text: "[CAVEMAN MODE ACTIVE. Respond terse" }] },
	];
	out = await cx({ messages: withReminder });
	assert.equal(out, undefined, "no double inject");
});

test("context dedup requires user role AND array content", async () => {
	const { handlers, commands, ctx } = harness();
	await commands.get("caveman").handler("full", ctx);
	const cx = handlers.get("context");
	// assistant last with reminder text → still injects
	let out = await cx({ messages: [{ role: "assistant", content: [{ type: "text", text: "CAVEMAN MODE ACTIVE" }] }] });
	assert.ok(out);
	// string content last → still injects
	out = await cx({ messages: [{ role: "user", content: "plain" }] });
	assert.ok(out);
});

// ── index re-exports ────────────────────────────────────────────────────
test("index.js re-exports the public surface", () => {
	for (const fn of ["filterSkillBodyForMode", "parseCavemanCommand", "resolveSessionMode", "readDefaultMode", "writeDefaultMode"]) {
		assert.equal(typeof ext[fn], "function", fn);
	}
	assert.equal(typeof ext.default, "function");
});

// silence unused var lint for existsSync import
void existsSync;
