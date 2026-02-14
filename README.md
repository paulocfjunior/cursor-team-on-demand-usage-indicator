# Cursor Team On-Demand Usage Indicator

Shows Cursor on-demand spend directly in the VS Code status bar.

## Features

- Status bar indicator with spend and renewal countdown, for example: `$ 1,320.12 (2d cycle end)`
- One-click QuickPick menu with details, refresh, logout, and open dashboard actions
- Login flow via Chrome + DevTools Protocol cookie capture
- Manual cookie paste fallback when browser automation is unavailable
- Secure cookie storage using `vscode.SecretStorage`

## Status Bar UX

The extension follows VS Code status bar guidelines:

- single status bar item
- short label text
- one icon per state
- contextual item on the right side

References:

- [Status Bar UX guidelines](https://code.visualstudio.com/api/ux-guidelines/status-bar)
- [Status bar sample extension](https://github.com/microsoft/vscode-extension-samples/tree/main/statusbar-sample)

## Settings

This extension contributes:

- `cursorUsage.teamId` (string, required): Cursor team ID used for API requests
- `cursorUsage.refreshIntervalSeconds` (enum: `10`, `15`, `30`, `60`, default `30`)

If `cursorUsage.teamId` is missing, the status bar shows `Cursor: Setup` and opens settings on click.

## Login & Session

- Preferred flow: `Login with Chrome` then `Finish Login`
- Fallback flow: `Paste Cookie Manually`
- Session token is stored in VS Code secret storage (OS keychain-backed)

The extension also attempts one-time import from legacy file `~/.cursor-session` for compatibility with the shell prototype.

## Development

```bash
npm install
npm run compile
npm run lint
npm test
```

## Run Locally (Extension Development Host)

1. Open this folder in VS Code or Cursor.
2. Run:

```bash
npm install
npm run compile
```

3. Press `F5` to launch an **Extension Development Host** window.
4. In the new window:
   - Open settings and set `cursorUsage.teamId`
   - Click the status bar item (`Cursor: Setup` or `Cursor: Login`)
   - Use `Login with Chrome` (or `Paste Cookie Manually`)
5. Validate states:
   - Missing team id -> `Cursor: Setup`
   - Missing/expired session -> `Cursor: Login`
   - Valid session -> `$(credit-card) $ ... (Xd cycle end)`

Tip: You can also run `Developer: Reload Window` in the development host after changes.

## Generate a VSIX

Yes. You can package this extension as a `.vsix` file.

```bash
npm install
npm run vsix:package
```

This generates a file like:

```text
cursor-team-on-demand-usage-indicator-0.0.1.vsix
```

Install it locally with:

```bash
code --install-extension cursor-team-on-demand-usage-indicator-0.0.1.vsix
```

Or in VS Code/Cursor: `Extensions: Install from VSIX...`

## Publish to VS Code Marketplace

Prerequisites:

1. Add your publisher in `package.json`:

```json
{
  "publisher": "your-publisher-id"
}
```

2. Create a Personal Access Token in Azure DevOps for Marketplace publishing.

Then publish with:

```bash
export VSCE_PAT="your_marketplace_token"
npm run vsix:publish
```

Version bump publish helpers:

```bash
npm run vsix:publish:patch
npm run vsix:publish:minor
npm run vsix:publish:major
```

## How to Use

1. Set `cursorUsage.teamId` in Settings.
2. Click the status bar item.
3. Choose one login method:
   - `Login with Chrome`, then `Finish Login`
   - `Paste Cookie Manually` (fallback)
4. Once authenticated, the status bar refreshes automatically using `cursorUsage.refreshIntervalSeconds`.
5. Click the status bar item anytime for:
   - usage details
   - refresh now
   - logout
   - open Cursor dashboard

## Tests

- Unit tests (`mocha`): JWT/session/api/status bar logic
- VS Code smoke tests (`vscode-test`): extension activation and command registration
