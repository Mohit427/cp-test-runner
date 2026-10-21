import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

type CompileResult =
	| { ok: true; binary: string }
	| { ok: false; message: string };

// Step A: returns the path of the active, saved .cpp file, or undefined on any problem
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

// Step B: compile the source with g++ into the temp folder
function compile(sourcePath: string): Promise<CompileResult> {
	return new Promise((resolve) => {
		const dir = path.join(os.tmpdir(), 'cp-test-runner');
		fs.mkdirSync(dir, { recursive: true });

		const binary = path.join(dir, process.platform === 'win32' ? 'sol.exe' : 'sol');
		// delete any old binary so a failed compile can never run stale code
		fs.rmSync(binary, { force: true });

		const child = spawn('g++', [sourcePath, '-O2', '-std=c++17', '-o', binary]);

		let stderr = '';
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});

		// fires when g++ cannot even be started (not installed / not on PATH)
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
			output.show(true); // true = don't steal focus from the editor
			output.appendLine(`Compiling ${filePath} ...`);

			const result = await compile(filePath);
			if (!result.ok) {
				output.appendLine('COMPILE ERROR:');
				output.appendLine(result.message);
				return;
			}

			output.appendLine(`Compiled OK -> ${result.binary}`);
			// Step C (run one test) will go here
		}
	);

	context.subscriptions.push(disposable, output);
}

export function deactivate() {}