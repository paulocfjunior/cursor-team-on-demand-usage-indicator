import * as vscode from "vscode";
import { StatusSnapshot, UsageData } from "./types";
import { getStatusBarPresentation } from "./statusPresentation";

export interface StatusBarHandlers {
    refreshUsage(): Promise<void>;
    startChromeLogin(): Promise<void>;
    finishChromeLogin(): Promise<void>;
    pasteCookie(): Promise<void>;
    logout(): Promise<void>;
    openDashboard(): Promise<void>;
    openTeamIdSettings(): Promise<void>;
    isLoginInProgress(): boolean;
}

type MenuAction =
    | "refresh"
    | "login"
    | "finishLogin"
    | "pasteCookie"
    | "logout"
    | "openDashboard"
    | "setupTeamId";

interface MenuItem extends vscode.QuickPickItem {
    action?: MenuAction;
}

function createUsageDetails(usage: UsageData): MenuItem[] {
    const cycleDetails = usage.cycleStartDate && usage.cycleEndDate
        ? `${usage.cycleStartDate} -> ${usage.cycleEndDate}`
        : usage.cycleEndDate
            ? `ends ${usage.cycleEndDate}`
            : "not available";
    const cycleDaysLeft = typeof usage.daysUntilCycleEnd === "number"
        ? ` (${usage.daysUntilCycleEnd}d left)`
        : "";

    return [
        { kind: vscode.QuickPickItemKind.Separator, label: "Cursor On-Demand Usage" },
        { label: `User: ${usage.userEmail}` },
        { label: `Today spend: ${usage.todaySpendFormatted}` },
        { label: `MTD spend: ${usage.mtdSpendFormatted}` },
        { label: `Cycle: ${cycleDetails}${cycleDaysLeft}` },
        { kind: vscode.QuickPickItemKind.Separator, label: "Actions" },
    ];
}

export class StatusBarManager implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private snapshot: StatusSnapshot = { kind: "loading" };

    constructor(private readonly handlers: StatusBarHandlers) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = "cursorUsage.showMenu";
    }

    initialize(subscriptions: vscode.Disposable[]): void {
        subscriptions.push(this.item);
        this.item.show();
        this.render();
    }

    setSnapshot(snapshot: StatusSnapshot): void {
        this.snapshot = snapshot;
        this.render();
    }

    getSnapshot(): StatusSnapshot {
        return this.snapshot;
    }

    async showMenu(): Promise<void> {
        const usage = this.snapshot.usage;
        const baseActions: MenuItem[] = [];

        if (this.snapshot.kind === "setup") {
            baseActions.push({
                label: "Set Team ID",
                description: "Open settings for cursorUsage.teamId",
                action: "setupTeamId",
            });
        } else if (usage) {
            baseActions.push(...createUsageDetails(usage));
            baseActions.push({ label: "Refresh Now", action: "refresh" });
            baseActions.push({ label: "Logout", action: "logout" });
            baseActions.push({ label: "Open Cursor Dashboard", action: "openDashboard" });
        } else {
            baseActions.push({ label: "Login with Chrome", action: "login" });
            if (this.handlers.isLoginInProgress()) {
                baseActions.push({ label: "Finish Login", action: "finishLogin" });
            }
            baseActions.push({ label: "Paste Cookie Manually", action: "pasteCookie" });
        }

        const picked = await vscode.window.showQuickPick(baseActions, {
            placeHolder: "Cursor Usage",
            ignoreFocusOut: true,
        });

        if (!picked?.action) {
            return;
        }

        if (picked.action === "refresh") {
            await this.handlers.refreshUsage();
            return;
        }
        if (picked.action === "login") {
            await this.handlers.startChromeLogin();
            return;
        }
        if (picked.action === "finishLogin") {
            await this.handlers.finishChromeLogin();
            return;
        }
        if (picked.action === "pasteCookie") {
            await this.handlers.pasteCookie();
            return;
        }
        if (picked.action === "logout") {
            await this.handlers.logout();
            return;
        }
        if (picked.action === "openDashboard") {
            await this.handlers.openDashboard();
            return;
        }
        if (picked.action === "setupTeamId") {
            await this.handlers.openTeamIdSettings();
        }
    }

    dispose(): void {
        this.item.dispose();
    }

    private render(): void {
        const presentation = getStatusBarPresentation(this.snapshot);
        this.item.text = presentation.text;
        this.item.tooltip = presentation.tooltip;
        this.item.show();
    }
}
