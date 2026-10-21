import * as vscode from 'vscode';

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

	await document.save(); // make sure disk matches what is on screen
	return document.fileName;
}

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand(
		'cp-test-runner.runAgainstSamples',
		async () => {
			const filePath = await getActiveCppFile();
			if (!filePath) {
				return;
			}
			// Placeholder: Step B (compile) will replace this
			vscode.window.showInformationMessage(`Runner triggered on: ${filePath}`);
		}
	);

	context.subscriptions.push(disposable);
}

export function deactivate() {}