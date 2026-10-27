# CP Test Runner

Run your C++ solution against sample tests in one click, with a live results panel inside VS Code. Built for competitive programming and contest practice.

![Demo](images/demo.gif)

## Features

**Running tests**
- Compiles the active `.cpp` file with `g++ -O2 -std=c++17` and runs it on every saved sample
- One command or shortcut (`Ctrl+Alt+R`) to compile and run everything
- Saves your file automatically before compiling, so you always test the latest code
- Clear verdicts per test: **PASS**, **FAIL** (wrong answer), **TLE** (time limit exceeded, 2 s), **RE** (runtime error)
- Execution time shown for every test, plus an overall `passed/total` summary

**Results panel**
- Live panel opens beside your editor without stealing focus
- Side-by-side expected vs actual output, with differing lines highlighted
- `stderr` shown for failing tests, which helps with crashes and debug prints
- Compile errors shown in full, so you can fix them without leaving the editor
- Follows your VS Code theme colors

**Managing samples**
- Add, edit, and delete samples directly in the panel; edits are saved to disk whenever you press a button
- A blank starter test is created the first time you run a file
- Samples are stored as plain `.in` / `.out` files next to your solution, so they are easy to keep in Git
- Tests are ordered naturally (`2` before `10`), and an `.in` file with no matching `.out` is reported instead of silently ignored
- Windows line endings and trailing whitespace never cause false failures

**Explain failure (optional AI hint)**
- An **Explain** button on FAIL, RE, and TLE tests asks Google Gemini for a short hint, never a full solution
- API key kept in VS Code secret storage; see [Explain failure](#explain-failure-optional-ai-hint) below

## Requirements

- `g++` available on your PATH
  - **Windows:** install MinGW-w64 or MSYS2 and add its `bin` folder to PATH
  - **macOS:** `xcode-select --install`
  - **Linux:** install `g++` from your package manager

## Usage

1. Open a `.cpp` file.
2. Run **CP Test Runner: Run Against Samples** from the Command Palette (or press `Ctrl+Alt+R`).
3. The first time, an empty test is created. Fill in the input and expected output in the panel.
4. Press **Run**. Use **Add test** and **Delete** to manage your samples.

## Commands and settings

| Command / setting | Description |
| --- | --- |
| **CP Test Runner: Run Against Samples** (`Ctrl+Alt+R` in C++ files) | Compile the active file and run all samples |
| **CP Test Runner: Set LLM API Key** | Store or remove the Gemini API key used by Explain |
| `cp-test-runner.llmModel` | Gemini model for Explain (default `gemini-2.5-flash`) |

## How samples are stored

For `solution.cpp`, samples live in a `solution.tests/` folder beside it:

```
solution.cpp
solution.tests/
  1.in    1.out
  2.in    2.out
```

Each `.in` file is fed to your program, and its output is compared with the matching `.out` file.

## Explain failure (optional, AI hint)

When a test is **FAIL**, **RE**, or **TLE**, an **Explain** button appears next to it. Clicking it asks Google Gemini for a short hint (2 to 4 sentences) that points toward the likely mistake. It never gives corrected code, and it never changes your files.

**Set up:**

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Run **CP Test Runner: Set LLM API Key** from the Command Palette and paste the key. It is stored in VS Code's secret storage, never in settings or files. Submit an empty value to remove it.
3. Optional: change the model with the `cp-test-runner.llmModel` setting (default `gemini-2.5-flash`).

**What is sent to Gemini** (only when you click Explain): the verdict, the failing test's input, expected output, actual output, stderr, and the source code of the solution that ran. Each field is capped (8000 characters for the source, 4000 for the others) and marked as truncated if cut. Nothing else from your workspace is sent.

**Limitations:**

- Hints can be wrong or vague. Treat them as a nudge, not an answer.
- Compile errors are not explained, since there is no failing test to attach them to.
- Requires internet access and is subject to your Gemini quota (you will see a message on HTTP 429).
- The problem statement is not sent, so the model infers intent from the code and samples.

## Install

**From a release:** download the `.vsix` from the [Releases](https://github.com/Mohit427/cp-test-runner/releases) page, then in VS Code open Extensions, click the `...` menu, and choose **Install from VSIX...**.

**From Open VSX:** search for "CP Test Runner" in editors that use Open VSX.

## Known limitations

- C++ only (compiled with `-O2 -std=c++17`)
- Fixed 2 second time limit per test
- Samples are entered manually, with no automatic fetching from judges

## Roadmap

- Configurable compiler flags and time limit
- Support for Python and Java
- Status bar button and test-all summary
- Import samples from the clipboard

## License

MIT