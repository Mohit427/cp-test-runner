import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { performance } from 'perf_hooks';

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

// Hour 3: sample storage. solution.cpp -> solution.tests/
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

// Creates the folder with empty 1.in / 1.out and opens them for editing
async function createStarterTests(dir: string): Promise<void> {
	fs.mkdirSync(dir, { recursive: true });
	const inPath = path.join(dir, '1.in');
	const outPath = path.join(dir, '1.out');
	if (!fs.existsSync(inPath)) {
		fs.writeFileSync(inPath, '');
	}
	if (!fs.existsSync(outPath)) {
		fs.writeFileSync(outPath, '');
	}

	const outDoc = await vscode.workspace.openTextDocument(outPath);
	await vscode.window.showTextDocument(outDoc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
	const inDoc = await vscode.workspace.openTextDocument(inPath);
	await vscode.window.showTextDocument(inDoc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('CP Test Runner');

	const disposable = vscode.commands.registerCommand(
		'cp-test-runner.runAgainstSamples',
		async () => {
			const filePath = await getActiveCppFile();
			if (!filePath) {
				return;
			}

			const { dir, tests, warnings } = loadTests(filePath);

			if (tests.length === 0) {
				await createStarterTests(dir);
				vscode.window.showInformationMessage(
					'No samples found. Created 1.in and 1.out. Fill them in, save, and run again.'
				);
				return;
			}

			output.clear();
			output.show(true);
			for (const w of warnings) {
				output.appendLine(`warning: ${w}`);
			}
			output.appendLine(`Compiling ${filePath} ...`);

			const result = await compile(filePath);
			if (!result.ok) {
				output.appendLine('COMPILE ERROR:');
				output.appendLine(result.message);
				return;
			}
			output.appendLine(`Compiled OK. Running ${tests.length} test(s)...\n`);

			let passed = 0;
			for (const t of tests) {
				const r = await runTest(result.binary, t.name, t.input, t.expected);
				if (r.status === 'PASS') {
					passed++;
				}

				output.appendLine(`[${r.status}] ${r.name} (${r.timeMs} ms)`);
				if (r.status === 'FAIL') {
					output.appendLine(`  expected: ${JSON.stringify(r.expected)}`);
					output.appendLine(`  actual:   ${JSON.stringify(r.actual)}`);
				}
				if (r.stderr && r.status !== 'PASS') {
					output.appendLine(`  stderr: ${r.stderr}`);
				}
			}

			output.appendLine(`\n${passed}/${tests.length} passed`);
		}
	);

	context.subscriptions.push(disposable, output);
}

export function deactivate() {}