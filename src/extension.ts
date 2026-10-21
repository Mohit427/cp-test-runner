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

// Step D: normalize line endings, trailing spaces per line, trailing newlines
function normalize(text: string): string {
	return text
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => line.replace(/\s+$/, ''))
		.join('\n')
		.replace(/\n+$/, '');
}

// Step C: run the binary on one input, enforce a timeout, compare with expected
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

		// program may exit before reading all input -> EPIPE; ignore it
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
		child.stdin.end(); // without this, programs reading until EOF hang
	});
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

			output.clear();
			output.show(true);
			output.appendLine(`Compiling ${filePath} ...`);

			const result = await compile(filePath);
			if (!result.ok) {
				output.appendLine('COMPILE ERROR:');
				output.appendLine(result.message);
				return;
			}
			output.appendLine('Compiled OK');

			// Hardcoded test for now: Hour 3 replaces this with saved samples.
			// Edit input/expected to match YOUR program.
			const test = await runTest(result.binary, 'test 1', '3\n1 2 3\n', '6');

			output.appendLine(`[${test.status}] ${test.name} (${test.timeMs} ms)`);
			if (test.status !== 'PASS') {
				output.appendLine(`  expected: ${JSON.stringify(test.expected)}`);
				output.appendLine(`  actual:   ${JSON.stringify(test.actual)}`);
			}
			if (test.stderr) {
				output.appendLine(`  stderr: ${test.stderr}`);
			}
		}
	);

	context.subscriptions.push(disposable, output);
}

export function deactivate() {}