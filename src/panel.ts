import * as vscode from 'vscode';

export interface ResultView {
	name: string;
	status: 'PASS' | 'FAIL' | 'TLE' | 'RE';
	timeMs: number;
	actual: string;
	expected: string;
	stderr: string;
}

export interface TestView {
	name: string;
	input: string;
	expected: string;
}

export interface PanelData {
	fileName: string;
	compileError?: string;
	warnings: string[];
	tests: TestView[];
	results: ResultView[];
}

export type MessageHandler = (msg: any) => void;

let panel: vscode.WebviewPanel | undefined;
let onMessage: MessageHandler | undefined;

function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let out = '';
	for (let i = 0; i < 32; i++) {
		out += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return out;
}

function toLines(text: string): string[] {
	const lines = text
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((l) => l.replace(/\s+$/, ''));
	while (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

function renderColumn(lines: string[], other: string[]): string {
	if (lines.length === 0) {
		return '<div class="empty">(empty)</div>';
	}
	return lines
		.map((line, i) => {
			const cls = line !== other[i] ? 'line diff' : 'line';
			return `<div class="${cls}">${esc(line) || '&nbsp;'}</div>`;
		})
		.join('');
}

function rowsFor(text: string): number {
	const n = text.split('\n').length;
	return Math.min(10, Math.max(3, n + 1));
}

function renderCard(t: TestView, r: ResultView | undefined): string {
	const status = r ? r.status : 'NONE';
	let result = '';

	if (r) {
		if (r.status === 'FAIL') {
			const exp = toLines(r.expected);
			const act = toLines(r.actual);
			result += `<div class="cols">
				<div><h4>Expected (diff)</h4>${renderColumn(exp, act)}</div>
				<div><h4>Actual</h4>${renderColumn(act, exp)}</div>
			</div>`;
		} else if (r.status === 'TLE') {
			result += '<p class="note">Time limit exceeded (2000 ms). Program was stopped.</p>';
		} else if (r.status === 'RE') {
			result += '<p class="note">Runtime error: the program exited with a non-zero code.</p>';
		}
		if (r.stderr && r.status !== 'PASS') {
			result += `<h4>stderr</h4><pre>${esc(r.stderr)}</pre>`;
		}
	}

	const badge = r ? `<span class="badge ${r.status}">${r.status}</span>` : '';
	const time = r ? `<span class="time">${r.timeMs} ms</span>` : '';
	const n = esc(t.name);

	return `<div class="card ${status}">
		<div class="head">
			${badge}
			<span class="name">${n}</span>
			${time}
			<button class="del small" data-name="${n}">Delete</button>
		</div>
		${result}
		<div class="cols">
			<div><h4>Input</h4>
				<textarea data-name="${n}" data-field="input" rows="${rowsFor(t.input)}" spellcheck="false">${esc(t.input)}</textarea></div>
			<div><h4>Expected output</h4>
				<textarea data-name="${n}" data-field="expected" rows="${rowsFor(t.expected)}" spellcheck="false">${esc(t.expected)}</textarea></div>
		</div>
	</div>`;
}

function render(data: PanelData, nonce: string): string {
	const passed = data.results.filter((r) => r.status === 'PASS').length;
	const total = data.results.length;

	let top = '';
	if (data.compileError !== undefined) {
		top = `<div class="compile"><h3>Compile error</h3><pre>${esc(data.compileError)}</pre></div>`;
	} else if (total > 0) {
		top = `<div class="summary ${passed === total ? 'ok' : 'bad'}">${passed}/${total} passed</div>`;
	} else if (data.tests.length > 0) {
		top = '<div class="hint">Edit your samples below, then press Run.</div>';
	}

	const warnings = data.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('');
	const cards = data.tests
		.map((t) => renderCard(t, data.results.find((r) => r.name === t.name)))
		.join('');
	const empty = data.tests.length === 0 ? '<div class="hint">No test cases. Press Add test.</div>' : '';

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 16px; }
	h2 { margin: 0; font-weight: 600; }
	h3 { margin: 0 0 8px 0; }
	h4 { margin: 10px 0 4px 0; font-size: 0.8em; opacity: 0.8; text-transform: uppercase; }
	.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
	.toolbar h2 { flex: 1; }
	button { font-family: inherit; cursor: pointer; border: none; border-radius: 3px; padding: 6px 14px;
		color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
	button:hover { background: var(--vscode-button-hoverBackground); }
	button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
	button.small { padding: 2px 8px; font-size: 0.85em; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
	.summary { font-size: 1.2em; font-weight: 600; padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; }
	.summary.ok { background: rgba(63,185,80,0.18); color: var(--vscode-testing-iconPassed, #3fb950); }
	.summary.bad { background: rgba(248,81,73,0.18); color: var(--vscode-testing-iconFailed, #f85149); }
	.hint { opacity: 0.75; margin-bottom: 12px; font-style: italic; }
	.card { border: 1px solid var(--vscode-panel-border, #444); border-left-width: 4px; border-radius: 4px; padding: 8px 12px; margin-bottom: 10px; }
	.card.PASS { border-left-color: var(--vscode-testing-iconPassed, #3fb950); }
	.card.FAIL { border-left-color: var(--vscode-testing-iconFailed, #f85149); }
	.card.TLE, .card.RE { border-left-color: var(--vscode-editorWarning-foreground, #d29922); }
	.head { display: flex; align-items: center; gap: 10px; }
	.name { font-weight: 600; flex: 1; }
	.time { opacity: 0.7; font-size: 0.9em; }
	.badge { font-size: 0.8em; font-weight: 700; padding: 2px 8px; border-radius: 3px; color: #fff; }
	.badge.PASS { background: #2ea043; }
	.badge.FAIL { background: #da3633; }
	.badge.TLE, .badge.RE { background: #9e6a03; }
	.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	.line, .empty, pre, textarea { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
	.line, .empty, pre { white-space: pre-wrap; word-break: break-all; }
	.line { padding: 1px 6px; }
	.line.diff { background: rgba(248,81,73,0.25); }
	.empty { opacity: 0.6; font-style: italic; padding: 1px 6px; }
	pre { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15)); padding: 8px; border-radius: 4px; margin: 0; }
	textarea { width: 100%; box-sizing: border-box; resize: vertical; padding: 6px;
		color: var(--vscode-input-foreground); background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, #555); border-radius: 3px; }
	.note { margin: 8px 0 0 0; opacity: 0.85; }
	.compile { border: 1px solid #da3633; border-radius: 4px; padding: 10px 12px; margin-bottom: 12px; }
	.compile h3 { color: var(--vscode-testing-iconFailed, #f85149); }
	.warn { background: rgba(210,153,34,0.18); padding: 6px 10px; border-radius: 4px; margin-bottom: 8px; font-size: 0.9em; }
</style>
</head>
<body>
	<div class="toolbar">
		<h2>${esc(data.fileName)}</h2>
		<button id="add" class="secondary">Add test</button>
		<button id="run">Run</button>
	</div>
	${warnings}
	${top}
	${empty}
	${cards}
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();

		// Snapshot of every textbox, so nothing typed is lost on any action
		function collect() {
			const map = {};
			document.querySelectorAll('textarea').forEach(function (t) {
				const n = t.dataset.name;
				if (!map[n]) { map[n] = { name: n, input: '', expected: '' }; }
				map[n][t.dataset.field] = t.value;
			});
			return Object.keys(map).map(function (k) { return map[k]; });
		}

		document.getElementById('run').addEventListener('click', function () {
			vscode.postMessage({ type: 'run', tests: collect() });
		});
		document.getElementById('add').addEventListener('click', function () {
			vscode.postMessage({ type: 'add', tests: collect() });
		});
		document.querySelectorAll('.del').forEach(function (b) {
			b.addEventListener('click', function () {
				vscode.postMessage({ type: 'delete', name: b.dataset.name, tests: collect() });
			});
		});
	</script>
</body>
</html>`;
}

export function showResults(data: PanelData, handler: MessageHandler): void {
	onMessage = handler;

	if (!panel) {
		panel = vscode.window.createWebviewPanel(
			'cpTestRunnerResults',
			'CP Test Runner',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		panel.webview.onDidReceiveMessage((m) => onMessage && onMessage(m));
		panel.onDidDispose(() => {
			panel = undefined;
		});
	} else {
		panel.reveal(undefined, true);
	}
	panel.webview.html = render(data, getNonce());
}