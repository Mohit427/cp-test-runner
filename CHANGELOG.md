# Change Log

All notable changes to the "cp-test-runner" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.0]

- Added **Explain failure**: an Explain button on FAIL, RE, and TLE tests that shows a short AI hint (Google Gemini) without giving away the solution
- Added the **CP Test Runner: Set LLM API Key** command (the key is kept in VS Code secret storage)
- Added the `cp-test-runner.llmModel` setting (default `gemini-2.5-flash`)
- No changes for passing tests or for users who don't use the new feature

## [0.1.0]

- Initial release