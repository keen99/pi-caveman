#!/usr/bin/env node
// Deep pinned-pi smoke for the caveman extension. Boots real pi in RPC mode
// with the extension loaded (CAVEMAN_DEBUG=1) and asserts session_start ran:
// the marker records the restored session mode + configured default. With a
// fresh session and no config file both equal DEFAULT_MODE ("full").
// Hook/toggle behavior is covered by unit tests; here we prove real pi
// accepts the extension and the session_start restore path executes.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'pi-caveman-deep-'));
const agentDir = join(dir, 'agent');
mkdirSync(join(agentDir, 'sessions', 'tmp'), { recursive: true });
// No externalAgent/defaultProvider settings needed — this extension makes no
// model calls. Marker proves load + session_start restore.
const MARKER = join(agentDir, 'caveman-loaded.json');

const child = spawn(
	process.env.PI_TEST_BIN ?? join(dirname(process.execPath), 'pi'),
	['--mode', 'rpc', '--no-extensions', '-e', join(root, 'index.js'), '--session-dir', join(agentDir, 'sessions', 'tmp')],
	{ env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, CAVEMAN_DEBUG: '1', XDG_CONFIG_HOME: join(agentDir, 'xdg') }, cwd: dir },
);
let out = '';
let err = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { err += d; });

const t0 = Date.now();
const killTimer = setTimeout(() => child.kill('SIGKILL'), 30_000);
const poll = setInterval(() => {
	if (existsSync(MARKER)) {
		clearInterval(poll);
		finish(true);
	} else if (Date.now() - t0 > 20_000) {
		clearInterval(poll);
		finish(false);
	}
}, 200);

function finish(ok) {
	child.kill('SIGTERM');
	child.on('exit', () => {
		clearTimeout(killTimer);
		try {
			assert2(ok, `timed out; stderr tail: ${err.slice(-800)}`);
			const m = JSON.parse(readFileSync(MARKER, 'utf8'));
			assert2(m.loaded === true, `loaded flag: ${JSON.stringify(m)}`);
			assert2(m.mode === 'full', `session mode restored to default: ${JSON.stringify(m)}`);
			assert2(m.default === 'full', `configured default: ${JSON.stringify(m)}`);
			console.log(`Deep smoke PASS: real pi loaded caveman; session mode=${m.mode}, default=${m.default} (${(Date.now() - t0) / 1000 | 0}s).`);
		} catch (e) {
			console.error('FAIL', e.message);
			console.error(`stdout tail: ${out.slice(-400)}`);
			process.exitCode = 1;
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}
function assert2(cond, msg) { if (!cond) throw new Error(msg); }
