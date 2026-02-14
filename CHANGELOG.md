# Change Log

All notable changes to the "cursor-team-on-demand-usage-indicator" extension will be documented in this file.

## [Unreleased]

- Replace boilerplate command with a real Cursor usage status bar extension
- Add secure session handling with `vscode.SecretStorage`
- Add Chrome CDP login and manual cookie paste fallback
- Add status menu actions: refresh, logout, open dashboard
- Add first-run setup guidance for missing `cursorUsage.teamId`
- Add configurable refresh interval setting (`10s`, `15s`, `30s`, `60s`)
- Add unit and VS Code smoke test coverage