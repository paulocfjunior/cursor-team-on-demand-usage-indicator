import * as vscode from "vscode";
import { clearApiCache, fetchTeamSpend, parseUsageData } from "./api";
import { isValid as isJwtValid } from "./jwt";
import { CdpLoginSession } from "./login";
import { clearSession, extractToken, importFromLegacyFile, isSessionValid, readSession, writeSession } from "./session";
import { StatusBarManager } from "./statusBar";
import { RefreshIntervalSeconds } from "./types";

const CONFIG_NAMESPACE = "cursorUsage";
const CONFIG_TEAM_ID = "teamId";
const CONFIG_REFRESH_INTERVAL = "refreshIntervalSeconds";

let statusBarManager: StatusBarManager | undefined;
let activeLoginSession: CdpLoginSession | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

function getTeamId(): string {
    return vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<string>(CONFIG_TEAM_ID, "").trim();
}

function getRefreshInterval(): RefreshIntervalSeconds {
    const value = vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<number>(CONFIG_REFRESH_INTERVAL, 30);
    if (value === 10 || value === 15 || value === 30 || value === 60) {
        return value;
    }
    return 30;
}

function isTeamConfigured(): boolean {
    return getTeamId().length > 0;
}

async function refreshUsage(context: vscode.ExtensionContext): Promise<void> {
    if (!statusBarManager) {
        return;
    }

    if (!isTeamConfigured()) {
        statusBarManager.setSnapshot({ kind: "setup" });
        return;
    }

    statusBarManager.setSnapshot({ kind: "loading" });

    try {
        const validSession = await isSessionValid(context.secrets);
        if (!validSession) {
            statusBarManager.setSnapshot({ kind: "login" });
            return;
        }

        const cookieString = await readSession(context.secrets);
        if (!cookieString) {
            statusBarManager.setSnapshot({ kind: "login" });
            return;
        }

        const response = await fetchTeamSpend(getTeamId(), cookieString);
        const usage = parseUsageData(response);
        statusBarManager.setSnapshot({ kind: "ready", usage });
    } catch (error) {
        statusBarManager.setSnapshot({
            kind: "error",
            message: error instanceof Error ? error.message : "Failed to refresh usage.",
        });
    }
}

function restartRefreshTimer(context: vscode.ExtensionContext): void {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }

    refreshTimer = setInterval(() => {
        void refreshUsage(context);
    }, getRefreshInterval() * 1000);
}

async function startChromeLogin(context: vscode.ExtensionContext): Promise<void> {
    if (activeLoginSession) {
        const action = await vscode.window.showInformationMessage(
            "Chrome login is already in progress.",
            "Finish Login",
            "Cancel Login",
        );
        if (action === "Finish Login") {
            await finishChromeLogin(context);
        } else if (action === "Cancel Login") {
            await activeLoginSession.cleanup();
            activeLoginSession = undefined;
            await refreshUsage(context);
        }
        return;
    }

    if (!isTeamConfigured()) {
        await vscode.window.showWarningMessage("Set cursorUsage.teamId in settings before login.");
        await openTeamIdSettings();
        return;
    }

    try {
        activeLoginSession = await CdpLoginSession.start();
        statusBarManager?.setSnapshot({ kind: "login" });
        const action = await vscode.window.showInformationMessage(
            "Chrome opened with a fresh profile. Sign in to cursor.com, then click Finish Login.",
            "Finish Login",
            "Cancel",
        );
        if (action === "Finish Login") {
            await finishChromeLogin(context);
        } else if (action === "Cancel" && activeLoginSession) {
            await activeLoginSession.cleanup();
            activeLoginSession = undefined;
            await refreshUsage(context);
        }
    } catch (error) {
        await vscode.window.showErrorMessage(
            error instanceof Error ? error.message : "Could not start Chrome login flow.",
        );
    }
}

async function finishChromeLogin(context: vscode.ExtensionContext): Promise<void> {
    if (!activeLoginSession) {
        await vscode.window.showInformationMessage("No active Chrome login session.");
        return;
    }

    try {
        const cookieString = await activeLoginSession.finish();
        await writeSession(context.secrets, cookieString);
        clearApiCache();
        await vscode.window.showInformationMessage("Login completed and session saved.");
    } catch (error) {
        await vscode.window.showErrorMessage(
            error instanceof Error ? error.message : "Could not capture cookies from Chrome.",
        );
    } finally {
        activeLoginSession = undefined;
        await refreshUsage(context);
    }
}

async function pasteCookieManually(context: vscode.ExtensionContext): Promise<void> {
    const rawInput = await vscode.window.showInputBox({
        prompt: "Paste WorkosCursorSessionToken value or full cookie string",
        placeHolder: "WorkosCursorSessionToken=...; team_id=...",
        ignoreFocusOut: true,
    });

    if (!rawInput) {
        return;
    }

    const cookieString = rawInput.includes("WorkosCursorSessionToken=")
        ? rawInput.trim()
        : `WorkosCursorSessionToken=${rawInput.trim()}`;

    const token = extractToken(cookieString);
    if (!token || !isJwtValid(token)) {
        await vscode.window.showErrorMessage("The pasted cookie is not a valid session token.");
        return;
    }

    await writeSession(context.secrets, cookieString);
    clearApiCache();
    await refreshUsage(context);
}

async function logout(context: vscode.ExtensionContext): Promise<void> {
    await clearSession(context.secrets);
    clearApiCache();
    if (activeLoginSession) {
        await activeLoginSession.cleanup();
        activeLoginSession = undefined;
    }
    statusBarManager?.setSnapshot({ kind: "login" });
}

async function openDashboard(): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse("https://cursor.com/dashboard?tab=usage"));
}

async function openTeamIdSettings(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.openSettings", "cursorUsage.teamId");
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    statusBarManager = new StatusBarManager({
        isLoginInProgress: () => Boolean(activeLoginSession),
        refreshUsage: async () => refreshUsage(context),
        startChromeLogin: async () => startChromeLogin(context),
        finishChromeLogin: async () => finishChromeLogin(context),
        pasteCookie: async () => pasteCookieManually(context),
        logout: async () => logout(context),
        openDashboard,
        openTeamIdSettings,
    });
    statusBarManager.initialize(context.subscriptions);

    context.subscriptions.push(
        vscode.commands.registerCommand("cursorUsage.showMenu", async () => {
            await statusBarManager?.showMenu();
        }),
        vscode.commands.registerCommand("cursorUsage.login", async () => startChromeLogin(context)),
        vscode.commands.registerCommand("cursorUsage.pasteCookie", async () => pasteCookieManually(context)),
        vscode.commands.registerCommand("cursorUsage.refresh", async () => refreshUsage(context)),
        vscode.commands.registerCommand("cursorUsage.logout", async () => logout(context)),
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (
                event.affectsConfiguration(`${CONFIG_NAMESPACE}.${CONFIG_REFRESH_INTERVAL}`) ||
                event.affectsConfiguration(`${CONFIG_NAMESPACE}.${CONFIG_TEAM_ID}`)
            ) {
                restartRefreshTimer(context);
                await refreshUsage(context);
            }
        }),
        {
            dispose: () => {
                if (refreshTimer) {
                    clearInterval(refreshTimer);
                }
            },
        },
    );

    await importFromLegacyFile(context.secrets);
    restartRefreshTimer(context);
    await refreshUsage(context);
}

export async function deactivate(): Promise<void> {
    if (activeLoginSession) {
        await activeLoginSession.cleanup();
        activeLoginSession = undefined;
    }
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }
}
