import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { performance } from 'perf_hooks';
import { showResults, postToPanel } from './panel';
import { explainFailure } from './explain';

type CompileResult =
	| { ok: true; binary: string }
	| { ok: false; message: string };

type TestStatus = 'PASS' | 'FAIL' | 'TLE' | 'RE';

interface TestResult {
	name: string;
	status: TestStatus;
	timeMs: number;
	actual: string;
	expected: string;
	stderr: string;
}

interface TestCase {
	name: string;
	input: string;
	expected: string;
}

interface PanelMessage {
	type: 'run' | 'add' | 'delete' | 'explain';
	name?: string;
	tests?: TestCase[];
}

// The .cpp file the panel is currently attached to
let currentSource: string | undefined;
let running = false;

const API_KEY_SECRET = 'cp-test-runner.llmApiKey';
const DEFAULT_MODEL = 'gemini-2.5-flash';
let secrets: vscode.SecretStorage | undefined;

// Snapshot of what actually ran, so a hint matches the code that produced the verdict
// even if the user has edited the file since
let lastRun: { source: string; tests: TestCase[]; results: TestResult[] } | undefined;
// Bumped on every re-render; replies for an older panel are dropped
let panelVersion = 0;
const inFlight = new Set<string>();

// Step A
async function getActiveCppFile(): Promise<string | undefined> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showErrorMessage('Open a .cpp file first.');
		return undefined;
	}

	const document = editor.document;

	if (document.languageId !== 'cpp') {
		vscode.window.showErrorMessage('The active file is not a C++ file.');
		return undefined;
	}

	if (document.isUntitled) {
		vscode.window.showErrorMessage('Save the file first so it has a path.');
		return undefined;
	}

	await document.save();
	return document.fileName;
}

// Step B
function compile(sourcePath: string): Promise<CompileResult> {
	return new Promise((resolve) => {
		const dir = path.join(os.tmpdir(), 'cp-test-runner');
		fs.mkdirSync(dir, { recursive: true });

		const binary = path.join(dir, process.platform === 'win32' ? 'sol.exe' : 'sol');
		fs.rmSync(binary, { force: true });

		const child = spawn('g++', [sourcePath, '-O2', '-std=c++17', '-o', binary]);

		let stderr = '';
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});

		child.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'ENOENT') {
				resolve({
					ok: false,
					message: 'g++ not found. Install MinGW-w64 (or MSYS2) and add it to PATH.',
				});
			} else {
				resolve({ ok: false, message: err.message });
			}
		});

		child.on('close', (code) => {
			if (code === 0) {
				resolve({ ok: true, binary });
			} else {
				resolve({ ok: false, message: stderr || `g++ exited with code ${code}` });
			}
		});
	});
}

// Step D
function normalize(text: string): string {
	return text
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => line.replace(/\s+$/, ''))
		.join('\n')
		.replace(/\n+$/, '');
}

// Step C
function runTest(
	binary: string,
	name: string,
	input: string,
	expected: string,
	timeoutMs = 2000
): Promise<TestResult> {
	return new Promise((resolve) => {
		const start = performance.now();
		const child = spawn(binary);

		let stdout = '';
		let stderr = '';
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);

		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});

		child.stdin.on('error', () => {});

		child.on('error', (err) => {
			clearTimeout(timer);
			resolve({
				name,
				status: 'RE',
				timeMs: Math.round(performance.now() - start),
				actual: stdout,
				expected,
				stderr: err.message,
			});
		});

		child.on('close', (code) => {
			clearTimeout(timer);
			const timeMs = Math.round(performance.now() - start);

			let status: TestStatus;
			if (timedOut) {
				status = 'TLE';
			} else if (code !== 0) {
				status = 'RE';
			} else {
				status = normalize(stdout) === normalize(expected) ? 'PASS' : 'FAIL';
			}

			resolve({ name, status, timeMs, actual: stdout, expected, stderr });
		});

		child.stdin.write(input);
		child.stdin.end();
	});
}

// ---------- sample storage ----------

function getTestsDir(sourcePath: string): string {
	const base = path.basename(sourcePath, path.extname(sourcePath));
	return path.join(path.dirname(sourcePath), `${base}.tests`);
}

function loadTests(sourcePath: string): { dir: string; tests: TestCase[]; warnings: string[] } {
	const dir = getTestsDir(sourcePath);
	const tests: TestCase[] = [];
	const warnings: string[] = [];

	if (!fs.existsSync(dir)) {
		return { dir, tests, warnings };
	}

	const inputFiles = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.in'))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

	for (const file of inputFiles) {
		const name = file.slice(0, -3);
		const inPath = path.join(dir, file);
		const outPath = path.join(dir, `${name}.out`);

		if (!fs.existsSync(outPath)) {
			warnings.push(`${file} has no matching ${name}.out, skipped`);
			continue;
		}

		tests.push({
			name,
			input: fs.readFileSync(inPath, 'utf8'),
			expected: fs.readFileSync(outPath, 'utf8'),
		});
	}

	return { dir, tests, warnings };
}

// Names come back from the webview, so never trust them as paths
function isSafeName(name: string): boolean {
	return name.length > 0 && !/[\\/]/.test(name) && !name.startsWith('.');
}

function saveTests(dir: string, tests: TestCase[]): void {
	fs.mkdirSync(dir, { recursive: true });
	for (const t of tests) {
		if (!isSafeName(t.name)) {
			continue;
		}
		fs.writeFileSync(path.join(dir, `${t.name}.in`), t.input);
		fs.writeFileSync(path.join(dir, `${t.name}.out`), t.expected);
	}
}

function addTest(sourcePath: string): void {
	const { dir, tests } = loadTests(sourcePath);
	let max = 0;
	for (const t of tests) {
		if (/^\d+$/.test(t.name)) {
			max = Math.max(max, parseInt(t.name, 10));
		}
	}
	const name = String(max + 1);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `${name}.in`), '');
	fs.writeFileSync(path.join(dir, `${name}.out`), '');
}

function deleteTest(dir: string, name: string): void {
	if (!isSafeName(name)) {
		return;
	}
	fs.rmSync(path.join(dir, `${name}.in`), { force: true });
	fs.rmSync(path.join(dir, `${name}.out`), { force: true });
}

// ---------- panel glue ----------

function refresh(results: TestResult[], compileError?: string): void {
	if (!currentSource) {
		return;
	}
	const { tests, warnings } = loadTests(currentSource);
	panelVersion++;
	showResults(
		{ fileName: path.basename(currentSource), compileError, warnings, tests, results },
		handleMessage
	);
}

async function runAll(): Promise<void> {
	if (!currentSource || running) {
		return;
	}
	running = true;
	try {
		// the panel is focused, so make sure the .cpp on disk is current
		const doc = vscode.workspace.textDocuments.find((d) => d.fileName === currentSource);
		if (doc && doc.isDirty) {
			await doc.save();
		}

		const { tests } = loadTests(currentSource);
		if (tests.length === 0) {
			refresh([]);
			return;
		}

		const compiled = await compile(currentSource);
		if (!compiled.ok) {
			refresh([], compiled.message);
			return;
		}

		const source = fs.readFileSync(currentSource, 'utf8');
		const results: TestResult[] = [];
		for (const t of tests) {
			results.push(await runTest(compiled.binary, t.name, t.input, t.expected));
		}
		lastRun = { source, tests, results };
		refresh(results);
	} finally {
		running = false;
	}
}

async function handleMessage(msg: PanelMessage): Promise<void> {
	if (!currentSource) {
		return;
	}
	const dir = getTestsDir(currentSource);

	// always persist what is currently typed in the boxes first
	if (Array.isArray(msg.tests)) {
		saveTests(dir, msg.tests);
	}

	if (msg.type === 'add') {
		addTest(currentSource);
		refresh([]);
	} else if (msg.type === 'delete' && msg.name) {
		deleteTest(dir, msg.name);
		refresh([]);
	} else if (msg.type === 'run') {
		await runAll();
	} else if (msg.type === 'explain' && msg.name) {
		await explainTest(msg.name);
	}
}

// ---------- explain failure ----------

async function setApiKey(): Promise<void> {
	const key = await vscode.window.showInputBox({
		title: 'CP Test Runner: Set LLM API Key',
		prompt: 'Paste your Gemini API key. It is kept in VS Code secret storage. Leave empty to remove it.',
		password: true,
		ignoreFocusOut: true,
	});
	if (key === undefined || !secrets) {
		return; // cancelled
	}
	if (key.trim() === '') {
		await secrets.delete(API_KEY_SECRET);
		vscode.window.showInformationMessage('LLM API key removed.');
	} else {
		await secrets.store(API_KEY_SECRET, key.trim());
		vscode.window.showInformationMessage('LLM API key saved.');
	}
}

async function explainTest(name: string): Promise<void> {
	const version = panelVersion;
	const flightKey = `${version}:${name}`;
	if (inFlight.has(flightKey)) {
		return; // double click
	}
	const reply = (text: string, error: boolean) => {
		if (version === panelVersion) {
			postToPanel({ type: 'hint', name, text, error });
		}
	};

	const run = lastRun;
	const result = run?.results.find((r) => r.name === name);
	const test = run?.tests.find((t) => t.name === name);
	if (!run || !result || !test || result.status === 'PASS') {
		reply('No failing result found for this test. Run the tests again.', true);
		return;
	}

	const apiKey = await secrets?.get(API_KEY_SECRET);
	if (!apiKey) {
		reply('No LLM API key set. Run "CP Test Runner: Set LLM API Key" from the Command Palette.', true);
		vscode.window
			.showWarningMessage('Explain failure needs a Gemini API key.', 'Set API Key')
			.then((choice) => {
				if (choice) {
					vscode.commands.executeCommand('cp-test-runner.setLlmApiKey');
				}
			});
		return;
	}

	inFlight.add(flightKey);
	try {
		const model = vscode.workspace.getConfiguration('cp-test-runner').get<string>('llmModel') || DEFAULT_MODEL;
		const res = await explainFailure(apiKey, model, {
			verdict: result.status,
			input: test.input,
			expected: result.expected,
			actual: result.actual,
			stderr: result.stderr,
			source: run.source,
		});
		reply(res.ok ? res.text : res.message, !res.ok);
	} finally {
		inFlight.delete(flightKey);
	}
}

export function activate(context: vscode.ExtensionContext) {
	secrets = context.secrets;
	context.subscriptions.push(
		vscode.commands.registerCommand('cp-test-runner.setLlmApiKey', setApiKey)
	);

	const disposable = vscode.commands.registerCommand(
		'cp-test-runner.runAgainstSamples',
		async () => {
			const filePath = await getActiveCppFile();
			if (!filePath) {
				return;
			}
			currentSource = filePath;

			// first time for this file: create an empty starter test and let the user fill it
			if (loadTests(filePath).tests.length === 0) {
				addTest(filePath);
				refresh([]);
				return;
			}

			await runAll();
		}
	);

	context.subscriptions.push(disposable);
}

export function deactivate() {}